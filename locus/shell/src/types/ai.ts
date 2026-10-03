/*
 * AI-facing contracts: the context packet the assistant would read, and the
 * broker's proposal / trusted-action lifecycle. These are the shapes the AI
 * runtime must obey — assembled and enforced locally, whether or not a real
 * model is ever connected.
 */

import type { AppId } from "./app";
import type { CapabilityTier } from "./permissions";
import type { ObjectType } from "./objects";

/** One thing the AI is being allowed to read, and where it comes from. */
export interface ContextItem {
  app: AppId;
  /** The readable capability label from the app's manifest. */
  label: string;
  /** Ids of objects contributing to this context, if any. */
  objectIds: string[];
}

/**
 * Everything the assistant would see before answering — assembled from the
 * active workspace, its AI context scope, connected sources, and the object
 * store, then filtered by the effective permission tiers. The context
 * inspector renders this verbatim so "what can the AI see" is never a mystery.
 */
export interface AIContextPacket {
  activeApp: AppId | null;
  activeWorkspace: string;
  selectedObjectId: string | null;
  /** Apps currently placed as Anchors in the active workspace. */
  visibleAnchors: AppId[];
  /** Apps the workspace scope + permissions actually allow reading. */
  scopedApps: AppId[];
  /** Readable capability lines, grouped per contributing app. */
  readableCapabilities: ContextItem[];
  /** Connected sources whose reading is currently enabled. */
  retrievedSources: string[];
  /** Recent audit summaries (most recent first). */
  recentActivity: string[];
  /** Count of local objects in scope. */
  objectCount: number;
  /**
   * The Cores' own AI views, assembled per scoped app: Time's upcoming
   * commitments, Cardspoke's selected-object description, People's cadence
   * lines — real context, not just counts. Redaction-passed.
   */
  coreSummaries: { core: string; lines: string[] }[];
  /** A one-paragraph, plain-language summary for the user. */
  userVisibilitySummary: string;
}

/* -------------------------------- Broker --------------------------------- */

export type ProposalStatus =
  | "pending"
  | "approved"
  /** An external effect whose async work was dispatched but has not settled. */
  | "executing"
  | "denied"
  | "executed"
  | "failed";

export type EffectKind = "create" | "update" | "delete" | "external";

/**
 * The concrete, declarative effect a proposal would have. Declarative so the
 * broker can both execute it and describe an undo. `external` effects have no
 * local object target and always require approval (or a trusted action).
 */
export interface ProposalEffect {
  kind: EffectKind;
  objectType?: ObjectType;
  /** For update/delete: the object to change. */
  targetId?: string;
  /** For create/update: fields to write. Kept loose; the broker validates.
      Only keys explicitly present are applied — absent keys are untouched. */
  payload?: {
    title?: string;
    body?: string;
    tags?: string[];
    done?: boolean;
  };
  /**
   * For update effects computed against a snapshot (Editor Core transactions):
   * the target's updatedAt when the effect was computed. Execution fails if
   * the object changed since, instead of silently overwriting newer edits.
   * Kept for older persisted proposals; `baseRev` is the primary check.
   */
  baseUpdatedAt?: number;
  /**
   * The target's monotonic revision when the effect was computed — the
   * version token stale-base detection prefers. Millisecond timestamps could
   * not tell two same-ms writes apart; revisions can.
   */
  baseRev?: number;
  /** For external effects: a human description of the outside action. */
  externalSummary?: string;
  /** External effects that only read (file access, page metadata). Must match
      the Action Definition's declared readOnly — a caller cannot assert this
      flag to weaken authorization. */
  readOnly?: boolean;
  /**
   * Structured input for the action's executor (e.g. the watch spec a
   * monitor.createWatch proposal carries). Only permitted when the Action
   * Definition declares `external.acceptsInput`; string values are redacted
   * before persistence like the rest of the effect.
   */
  input?: Record<string, unknown>;
}

/** Snapshot taken before an update/delete executes, so it can be undone. */
export interface EffectUndo {
  kind: "restore-fields" | "recreate-object" | "delete-created";
  /** For restore-fields / recreate-object: the prior object state. */
  snapshot?: unknown;
  targetId?: string;
}

/** A change the AI wants to make, awaiting the user's decision. */
export interface ActionProposal {
  id: string;
  createdAt: number;
  app: AppId;
  /** Namespaced action id, e.g. "writer.applyRewrite". */
  actionType: string;
  summary: string;
  detail?: string;
  effect: ProposalEffect;
  /** The capability tier this action falls under, for the audit trail. */
  tier: CapabilityTier;
  /** Security Core's risk classification, stored at propose time. */
  risk?: "safe" | "caution" | "dangerous";
  /** Plain-language undo note shown in the approval prompt. */
  undoNote?: string;
  status: ProposalStatus;
  resolvedAt?: number;
  /** The Core AI Core verified this action as originating from (Core id). Set
      when the proposal is routed through AI Core's proposeThroughCore. */
  originCore?: string;
  /** Set after execution so the user can see/undo what happened. */
  resultId?: string;
  /** Captured at execution for update/delete effects, so undo is real. */
  undo?: EffectUndo;
  /** Set once the user undoes an executed proposal. */
  undoneAt?: number;
  error?: string;
}

/**
 * A named, opt-in automation. Matches the spec: scope, trigger, data touched,
 * undo/rollback notes, and audit history. When enabled, matching proposals can
 * execute without a per-action approval — the deliberate, logged escalation.
 */
export interface TrustedAction {
  id: string;
  app: AppId;
  name: string;
  /** The proposal actionType this trusted action authorizes to run un-prompted. */
  actionType: string;
  scope: string;
  trigger: string;
  dataTouched: string;
  undoNotes: string;
  /**
   * Effect kinds this trusted action may auto-run. Defaults to create/update;
   * deletes and external effects never auto-run unless explicitly listed —
   * a trusted "create" action must not silently authorize a delete.
   */
  effectKinds?: EffectKind[];
  enabled: boolean;
  createdAt: number;
}
