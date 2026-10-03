/*
 * The Action Definition registry (stabilization Wave 1 — the structural
 * action contract).
 * ---------------------------------------------------------------------------
 * Every proposal actionType the AI can carry is bound here to its owner Core,
 * the apps allowed to propose it, the single effect kind it may have, the
 * object/target types it may touch, the payload fields it may write, whether
 * it is a read-only external effect, which Core owns its executor, the
 * governing capability labels per app, and its risk + undo semantics.
 *
 * Security Core authorizes against these definitions instead of matching
 * mutable capability-label prose: an unknown actionType, a mismatched effect
 * kind, a wrong object/target type, an undeclared payload field, a spoofed
 * proposing app, or a caller-asserted readOnly flag that disagrees with the
 * definition all DENY by default. The definition — not the proposal caller —
 * determines risk, read/write classification, executor ownership, and the
 * undo note.
 *
 * This module is deliberately dependency-light (types only) so Security Core,
 * the Broker, and AI Core can all consult it without import cycles.
 */

import type { AppId, EffectKind, ObjectType } from "@/types";
import type { CoreId } from "./cores/registry";

export type RiskLevel = "safe" | "caution" | "dangerous";

/** The payload keys a ProposalEffect can carry. */
export type PayloadField = "title" | "body" | "tags" | "done";

export interface ActionDefinition {
  /** Stable namespaced action id, e.g. "tasks.create". */
  id: string;
  /** The Core that owns this action's semantics (verified routing origin). */
  ownerCore: CoreId;
  /** Apps allowed to propose this action. Any other app id denies. */
  apps: AppId[];
  /** The one effect kind this action may carry. Any other kind denies. */
  effectKind: EffectKind;
  /** create: objectType values the effect may declare. */
  objectTypes?: ObjectType[];
  /** update/delete: object types the target may resolve to. */
  targetTypes?: ObjectType[];
  /** Payload keys the effect may carry. Absent means "no payload fields". */
  allowedFields?: PayloadField[];
  /** external actions only: declared read/write nature and executor owner.
      The proposal's own readOnly flag must MATCH readOnly here — a caller
      cannot assert readOnly to weaken the check. */
  external?: {
    readOnly: boolean;
    executorOwner: CoreId;
    /** May the effect carry a structured `input` record for the executor? */
    acceptsInput?: boolean;
  };
  /** Governing capability labels per proposing app. The label must sit in a
      permitted tier of the app's EFFECTIVE capabilities or the action denies. */
  labels: Partial<Record<AppId, string[]>>;
  /** Risk classification stored on the proposal and shown at approval. */
  risk: RiskLevel;
  /** The honest undo/recovery note for this specific action. */
  undoNote: string;
}

const DEFINITIONS: ActionDefinition[] = [
  {
    id: "tasks.create",
    ownerCore: "cardspoke",
    apps: ["tasks"],
    effectKind: "create",
    objectTypes: ["task"],
    allowedFields: ["title", "body", "tags", "done"],
    labels: { tasks: ["Create a task"] },
    risk: "caution",
    undoNote: "Undo deletes the created task.",
  },
  {
    id: "cards.create",
    ownerCore: "cardspoke",
    apps: ["cards"],
    effectKind: "create",
    objectTypes: ["card"],
    allowedFields: ["title", "body", "tags"],
    labels: { cards: ["Create a card"] },
    risk: "caution",
    undoNote: "Undo deletes the created card.",
  },
  {
    id: "editor.applyTransaction",
    ownerCore: "editor",
    apps: ["writer", "cards", "tasks", "assistant"],
    effectKind: "update",
    targetTypes: ["document", "card", "task", "memory"],
    allowedFields: ["title", "body"],
    labels: {
      writer: [
        "Apply an accepted rewrite",
        "Insert generated text",
        "Create a new document version",
      ],
      cards: ["Edit a card's body via an approved proposal"],
      tasks: ["Edit a task's body via an approved proposal"],
      assistant: ["Create or edit objects via an approved proposal"],
    },
    risk: "caution",
    undoNote: "Undo restores the previous values (a snapshot is kept at execution).",
  },
  {
    id: "time.reminder",
    ownerCore: "time",
    apps: ["time"],
    effectKind: "external",
    allowedFields: ["title"],
    external: { readOnly: false, executorOwner: "time" },
    labels: { time: ["Create a reminder"] },
    risk: "caution",
    undoNote: "The scheduled reminder can be cancelled or rescheduled in Time.",
  },
  {
    id: "files.access",
    ownerCore: "files",
    apps: ["files"],
    effectKind: "external",
    external: { readOnly: true, executorOwner: "files" },
    labels: { files: ["Connected file contents"] },
    risk: "safe",
    undoNote: "A one-shot read grant — revoke it in the grants list before it is consumed.",
  },
  {
    id: "files.index",
    ownerCore: "files",
    apps: ["files"],
    effectKind: "update",
    targetTypes: ["file"],
    allowedFields: ["title", "body", "tags"],
    labels: { files: ["Index connected sources on schedule"] },
    risk: "caution",
    undoNote: "Undo restores the previous metadata (a snapshot is kept at execution).",
  },
  {
    id: "writer.preview",
    ownerCore: "editor",
    apps: ["writer"],
    effectKind: "update",
    targetTypes: ["document"],
    allowedFields: [],
    labels: { writer: ["Render Markdown preview locally"] },
    risk: "safe",
    undoNote: "Nothing is written; switch back to write mode.",
  },
  {
    id: "web.pageContext",
    ownerCore: "web",
    apps: ["web"],
    effectKind: "external",
    external: { readOnly: true, executorOwner: "web" },
    labels: { web: ["Capture page title and description via an approved request"] },
    risk: "safe",
    undoNote: "Captured page metadata can be removed from the page-context list.",
  },
  {
    id: "monitor.createWatch",
    ownerCore: "monitor",
    apps: ["monitor"],
    effectKind: "external",
    allowedFields: ["title"],
    external: { readOnly: false, executorOwner: "monitor", acceptsInput: true },
    labels: { monitor: ["Create a watch"] },
    risk: "caution",
    undoNote: "The created watch can be paused or deleted in Monitor.",
  },
  {
    id: "secrets.use",
    ownerCore: "secrets",
    apps: ["vault"],
    effectKind: "external",
    allowedFields: ["title"],
    external: { readOnly: false, executorOwner: "secrets", acceptsInput: true },
    labels: { vault: ["Use a secret via brokered access (value never shown)"] },
    risk: "caution",
    undoNote: "A one-time use — the raw value is never shown and cannot be recalled.",
  },
  {
    id: "dev.install",
    ownerCore: "dev",
    apps: ["assistant"],
    effectKind: "external",
    external: { readOnly: false, executorOwner: "dev" },
    labels: { assistant: ["Install a validated Dev artifact after approval"] },
    risk: "dangerous",
    undoNote: "Uninstall from the artifact inspector; kept versions remain rollback points.",
  },
];

const BY_ID = new Map<string, ActionDefinition>(DEFINITIONS.map((d) => [d.id, d]));

export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return BY_ID.get(actionType);
}

export function listActionDefinitions(): ActionDefinition[] {
  return DEFINITIONS;
}
