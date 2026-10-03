/*
 * AI context assembly.
 * ---------------------------------------------------------------------------
 * Before answering, the assistant should read visible app state, selected
 * objects, recent activity, and connected-source summaries — but only what the
 * active workspace's scope and the per-app permission tiers allow. This module
 * builds that AIContextPacket honestly, so the context inspector can show the
 * user exactly what would be read. No model is called; the *governance* is the
 * product, and it is real.
 */

import { getActiveLayout, getCurrentArrangement } from "./desktop";
import { TILE_META } from "./tileMeta";
import { effectiveCapabilities } from "./permissions";
import { getApp } from "./appRegistry";
import { getEvents, record } from "./audit";
import { objectsOfType, getObject } from "./objects";
import { getSources, getSource } from "./sources";
import { describeUpcoming } from "./cores/time";
import { cardForAI } from "./cores/cardspoke";
import { contactForAI, dueFollowUps, upcomingBirthdays } from "./cores/people";
import { listPageContexts } from "./cores/web";
import { listRefsForAI } from "./cores/secrets";
import { redactText } from "./cores/secrets";
import type {
  AIContextPacket,
  AppId,
  ContextItem,
  ObjectType,
  SystemObject,
} from "@/types";

/**
 * One predicate for "may the AI retrieve this object" — index-excluded objects,
 * objects from a source whose reading the user disabled, and trashed files are
 * all withheld. Used to filter the context packet's object ids so hidden and
 * trashed content never enters model context.
 */
function isAIReadableObject(o: SystemObject): boolean {
  if (o.indexState === "excluded") return false;
  if (o.file?.deletedAt || o.trashedAt) return false;
  const src = getSource(o.source);
  if (src && !src.readable) return false;
  return true;
}

/** Which object type each app's readable context draws from (if any). */
const APP_OBJECT_TYPE: Partial<Record<AppId, ObjectType>> = {
  writer: "document",
  cards: "card",
  tasks: "task",
  projects: "project",
  files: "file",
  assistant: "memory",
};

export function buildContextPacket(
  activeApp: AppId | null,
  selectedObjectId: string | null = null,
): AIContextPacket {
  const ws = getActiveLayout();
  const arrangement = getCurrentArrangement();

  // Tiles the user has marked "Hide from AI" are excluded from visible context.
  const visibleTiles = arrangement.tiles.filter(
    (t) => t.kind !== "gap" && t.aiVisible !== false,
  );
  const visibleAnchors = visibleTiles
    .map((t) =>
      t.kind === "app"
        ? (t.app ?? null)
        : t.kind !== "gap" && t.kind !== "devwidget"
          ? (TILE_META[t.kind].focusApp ?? null)
          : null,
    )
    .filter((a): a is AppId => a !== null);

  // Apps whose tile is present but marked "Hide from AI" must be excluded even
  // if a persisted aiContextScope still names them — the current visibility
  // choice wins over a stale saved scope.
  const hiddenFromAI = new Set(
    arrangement.tiles
      .filter((t) => t.kind !== "gap" && t.aiVisible === false)
      .map((t) =>
        t.kind === "app"
        ? (t.app ?? null)
        : t.kind !== "gap" && t.kind !== "devwidget"
          ? (TILE_META[t.kind].focusApp ?? null)
          : null,
      )
      .filter((a): a is AppId => a !== null),
  );

  // Scope = the layout's declared AI context scope (falling back to the apps
  // actually visible on the desktop), restricted to apps that expose readable
  // capabilities after user overrides AND are not currently hidden from AI.
  const declaredScope =
    ws.aiContextScope && ws.aiContextScope.length ? ws.aiContextScope : [...new Set(visibleAnchors)];
  const scopedApps = declaredScope.filter((id) => {
    if (hiddenFromAI.has(id)) return false;
    const app = getApp(id);
    if (!app) return false;
    return effectiveCapabilities(id, app.permissions.ai).readable.length > 0;
  });

  const readableCapabilities: ContextItem[] = [];
  let objectCount = 0;
  for (const id of scopedApps) {
    const app = getApp(id);
    if (!app) continue;
    const readable = effectiveCapabilities(id, app.permissions.ai).readable;
    const type = APP_OBJECT_TYPE[id];
    // Only objects the AI is actually allowed to retrieve: not index-excluded,
    // from a readable source, and not trashed. Otherwise a hidden/trashed
    // object's id would still enter the model context via the packet.
    const objectIds = type
      ? objectsOfType(type).filter(isAIReadableObject).map((o) => o.id)
      : [];
    objectCount += objectIds.length;
    for (const label of readable) {
      readableCapabilities.push({ app: id, label, objectIds });
    }
  }

  const retrievedSources = getSources()
    .filter((s) => s.readable)
    .map((s) => s.name);

  // Recent activity is scoped to the apps in scope (plus source-level system
  // events), not the global audit tail — an app hidden from AI must not leak
  // its activity summaries into context.
  const scopeSet = new Set(scopedApps);
  const recentActivity = getEvents()
    .filter((e) => e.app === undefined || scopeSet.has(e.app))
    .slice(0, 5)
    .map((e) => e.summary);

  const summary = describeVisibility({
    workspace: ws.name,
    scopedApps,
    sources: retrievedSources,
    objectCount,
    activeApp,
  });

  return {
    activeApp,
    activeWorkspace: ws.name,
    selectedObjectId,
    visibleAnchors,
    scopedApps,
    readableCapabilities,
    retrievedSources,
    recentActivity,
    objectCount,
    coreSummaries: buildCoreSummaries(scopedApps, selectedObjectId),
    userVisibilitySummary: summary,
  };
}

/**
 * Assemble the Cores' own AI-facing views for the apps in scope — the
 * dormant read layer (describeUpcoming, cardForAI, contactForAI,
 * listRefsForAI) executed by real context assembly. Everything here is
 * either already redaction-shaped by its Core or passed through redactText.
 */
function buildCoreSummaries(
  scopedApps: AppId[],
  selectedObjectId: string | null,
): { core: string; lines: string[] }[] {
  const out: { core: string; lines: string[] }[] = [];
  const scope = new Set(scopedApps);

  if (scope.has("time") || scope.has("tasks")) {
    const upcoming = describeUpcoming(5);
    if (upcoming.length) out.push({ core: "time", lines: upcoming.map(redactText) });
  }
  if (selectedObjectId) {
    const line = cardForAI(selectedObjectId);
    if (line) out.push({ core: "cardspoke", lines: [redactText(line)] });
  }
  if (scope.has("people")) {
    const lines: string[] = [];
    for (const c of dueFollowUps().slice(0, 3)) {
      const line = contactForAI(c.id);
      if (line) lines.push(redactText(`due for follow-up · ${line}`));
    }
    for (const c of upcomingBirthdays(14).slice(0, 3)) {
      const line = contactForAI(c.id);
      if (line) lines.push(redactText(`birthday soon · ${line}`));
    }
    if (lines.length) out.push({ core: "people", lines });
  }
  if (scope.has("vault")) {
    const refs = listRefsForAI();
    if (refs.length) {
      out.push({
        core: "secrets",
        // Ref names are user-chosen text — redact them like everything else.
        lines: refs.map((r) => redactText(`${r.ref} (${r.category}) — AI access: ${r.aiAccess}`)),
      });
    }
  }
  if (scope.has("web")) {
    // Approved page-context captures ARE model context — the registry claim
    // made true. Only readable captures contribute (a CORS-blocked record has
    // nothing to read); title/description were redacted at capture and pass
    // redaction again here as defense in depth.
    const captured = listPageContexts()
      .filter((c) => c.readable)
      .slice(0, 3)
      .map((c) =>
        redactText(
          `${c.title ?? "(no title)"} — ${c.url}${c.description ? ` · ${c.description}` : ""}`,
        ),
      );
    if (captured.length) out.push({ core: "web", lines: captured });
  }
  return out;
}

function describeVisibility(input: {
  workspace: string;
  scopedApps: AppId[];
  sources: string[];
  objectCount: number;
  activeApp: AppId | null;
}): string {
  const appNames = input.scopedApps
    .map((id) => getApp(id)?.name)
    .filter(Boolean)
    .join(", ");
  const parts: string[] = [];
  parts.push(
    `In the ${input.workspace} workspace, the assistant may read from ${
      appNames || "no apps"
    }`,
  );
  parts.push(`across ${input.objectCount} local object${input.objectCount === 1 ? "" : "s"}`);
  if (input.sources.length) {
    parts.push(`and ${input.sources.length} connected source${input.sources.length === 1 ? "" : "s"} (${input.sources.join(", ")})`);
  }
  const active = input.activeApp ? getApp(input.activeApp)?.name : null;
  if (active) parts.push(`. The active surface is ${active}`);
  parts.push(
    ". Nothing is written, sent, or shared without a per-action approval or a trusted action.",
  );
  return parts.join(" ").replace(" .", ".");
}

/**
 * Record that the assistant read context. In a real runtime this fires before
 * an answer; here it is triggered from the context inspector so the audit trail
 * reflects genuine reads, not fabricated ones.
 */
export function logContextRead(packet: AIContextPacket): void {
  record({
    type: "ai.context_read",
    app: packet.activeApp ?? undefined,
    summary: `AI context assembled in ${packet.activeWorkspace}`,
    detail: `${packet.scopedApps.length} apps, ${packet.objectCount} objects, ${packet.retrievedSources.length} sources in scope.`,
  });
}

/** Resolve the titles of objects a packet would surface, for the inspector. */
export function packetObjectTitles(packet: AIContextPacket, limit = 8): string[] {
  const ids = new Set<string>();
  for (const item of packet.readableCapabilities) {
    for (const id of item.objectIds) ids.add(id);
  }
  return [...ids]
    .map((id) => getObject(id)?.title)
    .filter((t): t is string => Boolean(t))
    .slice(0, limit);
}
