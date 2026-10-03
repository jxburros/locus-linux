/*
 * AI Core — the OS-level intelligence layer (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: context assembly, model routing, assistant state, action planning,
 * proposal creation, Core routing rules, and AI-visible system contracts.
 * AI Core decides what context an assistant can see, which model/provider
 * should handle a task, and which Core should execute or propose each
 * action. It coordinates, proposes, and routes — it never mutates directly.
 *
 * The assistant, context assembly, and the broker lifecycle already exist
 * (core/assistant, core/aiContext, core/broker). This Core names them one
 * system and encodes the central rule as data:
 *
 *   The AI uses Cores. It never bypasses them.
 *
 * Model routing follows the AI Server Studio pattern (its Model Traffic
 * Manager): user-defined keyword rules map task text to a local or cloud
 * route, kept in one place so routing logic never scatters into apps.
 */

import { storage, StoreKeys } from "../storage";
import { propose, type ProposeInput } from "../broker";
import { buildContextPacket } from "../aiContext";
import { record } from "../audit";
import { getActionDefinition } from "../actionRegistry";
import type { ActionProposal } from "@/types";
import type { CoreId } from "./registry";

export { buildContextPacket };

/** Which Core an AI intention must route through (Rule 2 of the directive). */
export const AI_CORE_ROUTES: { intent: string; core: CoreId; how: string }[] = [
  { intent: "Edit a document or text", core: "editor", how: "propose an Editor Core edit transaction (diff preview included)" },
  { intent: "Create a note, card, or task", core: "cardspoke", how: "createCard via an approved proposal" },
  { intent: "Link, convert, or retrieve user objects", core: "cardspoke", how: "links/backlinks, reversible conversions, saved filters" },
  { intent: "Set a due date, reminder, or alarm", core: "time", how: "createReminder / requestTrigger" },
  { intent: "Explain upcoming commitments", core: "time", how: "describeUpcoming — plain-language schedule" },
  { intent: "Watch something for the user", core: "monitor", how: "createWatch (visible in Monitor)" },
  { intent: "Access a file", core: "files", how: "file references + redacted metadata; contents via requestFileAccess" },
  { intent: "Retrieve context or cite sources", core: "search", how: "buildContextSnippets — redacted, source-labeled" },
  { intent: "Reason about a person or follow-up", core: "people", how: "contactForAI + cadence; contact details need approval" },
  { intent: "Use a credential", core: "secrets", how: "brokered use of a secret:// reference — never the raw value" },
  { intent: "Alert the user", core: "notification", how: "deliver with a priority; never a silent side-effect" },
  { intent: "Open or pin a web app", core: "web", how: "the shortcut model, on user approval" },
  { intent: "Read a web page", core: "web", how: "requestPageContext — permissioned, never a hidden browser" },
  { intent: "Generate or modify an app, widget, or anchor", core: "dev", how: "a Dev Core artifact: diff, manifest, validate, sandbox, then install" },
  { intent: "Inspect media", core: "media", how: "mediaMetaFor — allowed metadata only" },
];

/**
 * The one door for AI-initiated changes: everything becomes an ActionProposal
 * in the broker (approve / deny / trusted), and the VERIFIED origin Core is
 * recorded and persisted on the proposal — so the audit trail reads
 * AI Core → Security gate → Broker for every write, and a caller cannot label
 * an action as coming from a Core it does not belong to. Ownership comes from
 * the Action Definition registry (the same contract Security enforces), not a
 * private table that could drift from it.
 */
export async function proposeThroughCore(
  core: CoreId,
  input: ProposeInput,
): Promise<ActionProposal> {
  const expected = getActionDefinition(input.actionType)?.ownerCore;
  const mismatch = !!expected && expected !== core;
  const originCore = expected ?? core;
  record({
    type: "ai.routed",
    summary: `AI Core routed an action through ${originCore} Core`,
    detail: mismatch
      ? `Routing corrected: “${input.actionType}” is owned by ${expected} Core, not ${core}`
      : input.summary,
  });
  return propose({ ...input, originCore });
}

/* -------------------------------- model routing ------------------------------ */

export type ModelRoute = "local" | "cloud";

/**
 * A user-defined routing rule: if the task text matches any keyword in the
 * pattern (comma-separated), it should go to this route/model. Kept as data
 * in one place — the Model Traffic Manager principle.
 */
export interface RoutingRule {
  id: string;
  /** Comma-separated keywords; a match on any keyword selects the rule. */
  pattern: string;
  route: ModelRoute;
  /** Optional provider/model hint for the runtime, e.g. "llama3" or "claude". */
  modelHint?: string;
  enabled: boolean;
  createdAt: number;
}

let seq = 0;
function makeId(): string {
  seq += 1;
  return `route-${Date.now().toString(36)}-${seq.toString(36)}`;
}

let cache: RoutingRule[] | null = null;

function load(): RoutingRule[] {
  if (cache === null) cache = storage.get<RoutingRule[]>(StoreKeys.aiRouting, []);
  return cache;
}

function save(next: RoutingRule[]): void {
  cache = next;
  storage.set(StoreKeys.aiRouting, next);
}

export function listRoutingRules(): RoutingRule[] {
  return load();
}

export function subscribeRouting(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.aiRouting, () => {
    cache = storage.get<RoutingRule[]>(StoreKeys.aiRouting, []);
    fn();
  });
}

/** Keyword patterns only — letters, digits, underscores, spaces. No regex
    is ever built from user input (the AI Server Studio safety rule). */
export function isValidPattern(pattern: string): boolean {
  const keywords = pattern.split(",");
  if (keywords.length === 0 || keywords.length > 20 || pattern.length > 200) return false;
  return keywords.every((kw) => /^[\w ]{1,50}$/.test(kw.trim()) && kw.trim().length > 0);
}

export function addRoutingRule(input: {
  pattern: string;
  route: ModelRoute;
  modelHint?: string;
}): RoutingRule | null {
  if (!isValidPattern(input.pattern)) return null;
  const rule: RoutingRule = {
    id: makeId(),
    pattern: input.pattern.trim(),
    route: input.route,
    modelHint: input.modelHint?.trim() || undefined,
    enabled: true,
    createdAt: Date.now(),
  };
  save([rule, ...load()]);
  record({
    type: "system.event",
    summary: `AI Core: routing rule added — “${rule.pattern}” → ${rule.route}${rule.modelHint ? ` (${rule.modelHint})` : ""}`,
  });
  return rule;
}

export function setRoutingRuleEnabled(id: string, enabled: boolean): void {
  const rule = load().find((r) => r.id === id);
  if (!rule || rule.enabled === enabled) return;
  save(load().map((r) => (r.id === id ? { ...r, enabled } : r)));
  // A routing-policy change (which model a task can reach) is auditable, like
  // any other permission change — enable/disable were previously silent.
  record({
    type: "system.event",
    summary: `AI Core: routing rule ${enabled ? "enabled" : "disabled"} — “${rule.pattern}” → ${rule.route}`,
  });
}

export function removeRoutingRule(id: string): void {
  const rule = load().find((r) => r.id === id);
  if (!rule) return;
  save(load().filter((r) => r.id !== id));
  record({
    type: "system.event",
    summary: `AI Core: routing rule removed — “${rule.pattern}” → ${rule.route}`,
  });
}

export interface RouteSuggestion {
  route: ModelRoute;
  modelHint?: string;
  reason: string;
}

/** Does the keyword appear as whole words in the text? Substring matching
    routed "scarf" on a "car" rule — dangerous once a rule targets a cloud
    route, so keywords match at word boundaries only. Keywords are restricted
    to [\w ] by isValidPattern, so \b anchors are always meaningful. */
function keywordMatches(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Where should this task run? First matching enabled rule wins; the default
 * is local — the privacy posture is that nothing leaves the device unless
 * the user routed it out.
 */
export function suggestRoute(taskText: string): RouteSuggestion {
  const haystack = taskText.toLowerCase();
  for (const rule of load()) {
    if (!rule.enabled) continue;
    const matched = rule.pattern
      .split(",")
      .map((kw) => kw.trim().toLowerCase())
      .filter(Boolean)
      .find((kw) => keywordMatches(haystack, kw));
    if (matched) {
      return {
        route: rule.route,
        modelHint: rule.modelHint,
        reason: `Matched routing rule keyword “${matched}”`,
      };
    }
  }
  return { route: "local", reason: "No rule matched — local by default" };
}
