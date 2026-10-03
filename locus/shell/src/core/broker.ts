/*
 * The AI Broker — the propose → approve/deny → execute lifecycle.
 * ---------------------------------------------------------------------------
 * The security boundary of Locus is *action*, not reading. Any change the AI
 * wants to make becomes an ActionProposal: it is recorded, shown to the user,
 * and executed only after an explicit approval — or automatically if a matching
 * Trusted Action is enabled. Every transition is written to the audit log, so
 * the entire chain of custody for a change is visible after the fact.
 *
 * Security Core gates the lifecycle (F3): every proposal is authorized at
 * propose time — forbidden actions are refused, risk and an undo note are
 * stored on the proposal — and trusted actions only auto-run the effect kinds
 * they explicitly cover. Proposal text passes through Secrets Core redaction
 * (F5) so a pasted key never reaches the queue, notifications, or the log.
 *
 * Effects are declarative (create/update/delete/external). Update and delete
 * snapshot the prior state at execution, so undo is real, not a label.
 *
 * Concurrency (stabilization Wave 2): every lifecycle transition happens
 * inside storage.update() — a fresh read-modify-write under an exclusive
 * cross-tab lock — so two tabs cannot both approve or both execute the same
 * proposal, and a proposal appended in one tab cannot be lost to a stale-cache
 * overwrite in another. The lifecycle functions are therefore async.
 *
 * NOTE for executor authors: a synchronous executor runs while the proposals
 * lock is held — it must never (synchronously) call propose/approve/execute
 * itself, or it deadlocks on the lock it is inside. Async executors run after
 * the lock is released.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";
import { deliver } from "./cores/notification";
import { getApp } from "./appRegistry";
import {
  createObject,
  updateObject,
  deleteObject,
  getObject,
  restoreObject,
} from "./objects";
import { redactText } from "./cores/secrets";
import { authorizeProposal, trustedActionCovers, trustedTierPermits } from "./cores/security";
import { getActionDefinition } from "./actionRegistry";
import { effectiveCapabilities } from "./permissions";
import type {
  ActionProposal,
  AICapabilities,
  AppId,
  EffectUndo,
  ProposalEffect,
  ProposalStatus,
  SystemObject,
  TrustedAction,
} from "@/types";

const MAX_PROPOSALS = 200;
let seq = 0;
function makeId(prefix: string): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${rand}`;
}

/** The proposing app's *effective* AI tiers — manifest merged with overrides. */
function capsFor(app: AppId): AICapabilities | undefined {
  const module = getApp(app);
  return module ? effectiveCapabilities(app, module.permissions.ai) : undefined;
}

/**
 * F5 completion: redact the effect *payload*, not just the summary/detail. The
 * effect is persisted on every proposal (accepted and refused) and its payload
 * values are what execution writes into objects — so a pasted key in a title,
 * body, tag, executor input, or external summary must be redacted here too, or
 * it survives in proposal storage and approval diffs and can later be written
 * to an object.
 */
function redactEffect(effect: ProposalEffect): ProposalEffect {
  const next: ProposalEffect = { ...effect };
  if (effect.payload) {
    next.payload = { ...effect.payload };
    if (typeof next.payload.title === "string") next.payload.title = redactText(next.payload.title);
    if (typeof next.payload.body === "string") next.payload.body = redactText(next.payload.body);
    if (Array.isArray(next.payload.tags)) {
      next.payload.tags = next.payload.tags.map((t) => (typeof t === "string" ? redactText(t) : t));
    }
  }
  if (typeof effect.externalSummary === "string") {
    next.externalSummary = redactText(effect.externalSummary);
  }
  if (effect.input) {
    // Executor input is persisted with the proposal too — a pasted key inside
    // a watch URL or purpose string must not survive in proposal storage.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(effect.input)) {
      cleaned[k] = typeof v === "string" ? redactText(v) : v;
    }
    next.input = cleaned;
  }
  return next;
}

/* ----------------------------- Proposals -------------------------------- */

/*
 * Reads go straight through storage.get — its snapshot cache already returns
 * a stable reference until the raw value changes (what useSyncExternalStore
 * needs), so a module-level cache would only add a staleness hazard for
 * background consumers.
 */
function loadProposals(): ActionProposal[] {
  return storage.get<ActionProposal[]>(StoreKeys.proposals, [], Array.isArray);
}

/**
 * Enforce the queue cap, evicting resolved proposals first. Pending proposals
 * are never silently dropped — if the queue is somehow all-pending, the
 * overflow is refused loudly on the audit record.
 */
function withCap(list: ActionProposal[]): ActionProposal[] {
  if (list.length <= MAX_PROPOSALS) return list;
  const pending = list.filter((p) => p.status === "pending");
  const resolved = list.filter((p) => p.status !== "pending");
  const keepResolved = resolved.slice(0, Math.max(0, MAX_PROPOSALS - pending.length));
  let next = list.filter((p) => p.status === "pending" || keepResolved.includes(p));
  if (next.length > MAX_PROPOSALS) {
    const dropped = next.slice(MAX_PROPOSALS);
    next = next.slice(0, MAX_PROPOSALS);
    record({
      type: "ai.refused",
      summary: `Broker: ${dropped.length} pending proposal${dropped.length === 1 ? "" : "s"} dropped — the queue is full`,
      detail: dropped.map((p) => p.summary).join("; ").slice(0, 400),
    });
  }
  return next;
}

/** One locked, fresh read-modify-write over the proposal list. */
async function mutateProposals(
  mutate: (list: ActionProposal[]) => ActionProposal[],
): Promise<void> {
  await storage.update<ActionProposal[]>(StoreKeys.proposals, [], mutate, Array.isArray);
}

export function getProposals(): ActionProposal[] {
  return loadProposals();
}
export function pendingProposals(): ActionProposal[] {
  return loadProposals().filter((p) => p.status === "pending");
}

export interface ProposeInput {
  app: AppId;
  actionType: string;
  summary: string;
  detail?: string;
  effect: ProposalEffect;
  /** The verified origin Core, set by AI Core's proposeThroughCore. */
  originCore?: string;
}

/**
 * Create a proposal. Security Core authorizes it first — refused actions
 * never enter the queue as pending. If an enabled Trusted Action covers this
 * actionType *and* this effect kind, it executes immediately (still fully
 * logged); otherwise it waits in the approval queue.
 */
export async function propose(input: ProposeInput): Promise<ActionProposal> {
  const app = getApp(input.app);
  // F5: one redaction choke point — proposal text AND the effect payload can
  // carry pasted content. The effect is redacted before it is ever persisted.
  const summary = redactText(input.summary);
  const detail = input.detail ? redactText(input.detail) : undefined;
  const effect = redactEffect(input.effect);

  // F3: the Security Core gate, with the app's effective capability tiers.
  const verdict = authorizeProposal({
    app: input.app,
    actionType: input.actionType,
    effect,
    capabilities: capsFor(input.app),
  });
  if (!verdict.allowed) {
    const refused: ActionProposal = {
      id: makeId("prop"),
      createdAt: Date.now(),
      app: input.app,
      actionType: input.actionType,
      summary,
      detail,
      effect,
      originCore: input.originCore,
      tier: "forbidden",
      status: "denied",
      resolvedAt: Date.now(),
      error: verdict.reason,
    };
    await mutateProposals((list) => withCap([refused, ...list]));
    record({
      type: "ai.refused",
      app: input.app,
      summary: `Refused by Security Core: ${summary}`,
      detail: verdict.reason,
    });
    return refused;
  }

  const trusted = enabledTrustedActionFor(input.app, input.actionType, effect);
  const proposal: ActionProposal = {
    id: makeId("prop"),
    createdAt: Date.now(),
    app: input.app,
    actionType: input.actionType,
    summary,
    detail,
    effect,
    originCore: input.originCore,
    tier: trusted ? "trusted" : "writableWithApproval",
    risk: verdict.risk,
    undoNote: verdict.undoNote,
    status: trusted ? "approved" : "pending",
  };
  await mutateProposals((list) => withCap([proposal, ...list]));
  record({
    type: "ai.proposed",
    app: input.app,
    summary: `${app?.name ?? input.app} proposed: ${summary}`,
    detail,
  });
  if (!trusted) {
    deliver({
      title: "Approval requested",
      detail: summary,
      source: app?.name ?? "AI",
      actions: [{ label: "Review", kind: "open-app", appId: "assistant" }],
    });
    return proposal;
  }

  record({
    type: "trusted_action.run",
    app: input.app,
    summary: `Trusted action ran: ${trusted.name}`,
    detail: summary,
  });
  return (await execute(proposal.id)) ?? proposal;
}

/** Patch one proposal under the lock. */
async function updateProposal(
  id: string,
  patch: Partial<ActionProposal>,
): Promise<ActionProposal | undefined> {
  let out: ActionProposal | undefined;
  await mutateProposals((list) =>
    list.map((p) => {
      if (p.id !== id) return p;
      out = { ...p, ...patch };
      return out;
    }),
  );
  return out;
}

/**
 * Approve a pending proposal. The pending → approved transition happens under
 * the proposals lock with a fresh read, so a proposal another tab already
 * resolved cannot be re-approved (double-execution guard, F3). Policy is
 * re-checked — it may have tightened since the proposal was created.
 */
export async function approve(id: string): Promise<ActionProposal | undefined> {
  let approved = false;
  let result: ActionProposal | undefined;
  await mutateProposals((list) => {
    const p = list.find((x) => x.id === id);
    result = p;
    if (!p || p.status !== "pending") return list;
    const verdict = authorizeProposal({
      app: p.app,
      actionType: p.actionType,
      effect: p.effect,
      capabilities: capsFor(p.app),
    });
    if (!verdict.allowed) {
      record({
        type: "ai.refused",
        app: p.app,
        summary: `Approval refused by Security Core: ${p.summary}`,
        detail: verdict.reason,
      });
      result = { ...p, status: "denied", resolvedAt: Date.now(), error: verdict.reason };
    } else {
      record({ type: "ai.approved", app: p.app, summary: `Approved: ${p.summary}` });
      result = { ...p, status: "approved" };
      approved = true;
    }
    return list.map((x) => (x.id === id ? result! : x));
  });
  if (!approved) return result;
  return execute(id);
}

export async function deny(id: string): Promise<ActionProposal | undefined> {
  let result: ActionProposal | undefined;
  await mutateProposals((list) => {
    const p = list.find((x) => x.id === id);
    result = p;
    if (!p || p.status !== "pending") return list;
    record({ type: "ai.denied", app: p.app, summary: `Declined: ${p.summary}` });
    result = { ...p, status: "denied", resolvedAt: Date.now() };
    return list.map((x) => (x.id === id ? result! : x));
  });
  return result;
}

/* --------------------------- external executors -------------------------- */

/**
 * The truthful outcome of an external effect. Executors return this (or a bare
 * string treated as a success note, or void for plain success), or a Promise
 * of one for asynchronous work — so the broker records what actually happened
 * instead of assuming success the moment it dispatched.
 */
export interface ExecutorOutcome {
  status: "succeeded" | "failed" | "cancelled" | "partial";
  /** Audit-safe detail (already redaction-shaped by the executor). */
  detail?: string;
  /** For create-like external effects, an id the result can be found under. */
  resultId?: string;
}
export type ExternalExecutor = (
  proposal: ActionProposal,
) => ExecutorOutcome | string | void | Promise<ExecutorOutcome | string | void>;
const externalExecutors = new Map<string, ExternalExecutor>();

/**
 * Cores register how their external effects actually run on approval —
 * Files Core mints a read grant, Web Core captures page context. Without a
 * registered executor the broker records the intent honestly and does
 * nothing (there is no pretend credential broker).
 *
 * Registration is once-only: a second registration for the same actionType is
 * ignored (the original owner keeps the slot), so a later module can no longer
 * silently hijack Files/Web/Dev behavior by re-registering. Executor ownership
 * is also structural: only an actionType whose Action Definition declares an
 * external executor may register one at all — an executor for an unknown or
 * non-external action is refused.
 */
export function registerExternalExecutor(actionType: string, fn: ExternalExecutor): void {
  const def = getActionDefinition(actionType);
  if (!def?.external) {
    console.warn(
      `[locus:broker] refused executor registration for "${actionType}" — no Action Definition declares an external executor for it`,
    );
    return;
  }
  if (externalExecutors.has(actionType)) {
    console.warn(
      `[locus:broker] external executor for "${actionType}" is already registered; keeping the original owner`,
    );
    return;
  }
  externalExecutors.set(actionType, fn);
}

function normalizeOutcome(v: ExecutorOutcome | string | void): ExecutorOutcome {
  if (v == null) return { status: "succeeded" };
  if (typeof v === "string") return { status: "succeeded", detail: v };
  return v;
}

/** Record the settled outcome of an external effect; returns the patch. */
function externalOutcomePatch(
  p: ActionProposal,
  effect: ProposalEffect,
  outcome: ExecutorOutcome,
): Partial<ActionProposal> {
  const label = effect.externalSummary ?? p.summary;
  if (outcome.status === "failed" || outcome.status === "cancelled") {
    record({
      type: "system.event",
      app: p.app,
      summary: `External action ${outcome.status}: ${label}`,
      detail: outcome.detail,
    });
    return {
      status: "failed",
      resolvedAt: Date.now(),
      error: outcome.detail ?? outcome.status,
    };
  }
  record({
    type: "ai.executed",
    app: p.app,
    summary: `External action executed${outcome.status === "partial" ? " (partial)" : ""}: ${label}`,
    detail: outcome.detail,
  });
  return { status: "executed", resolvedAt: Date.now(), resultId: outcome.resultId };
}

/** Persist the settled outcome of an async external effect. */
async function finishExternal(
  id: string,
  p: ActionProposal,
  effect: ProposalEffect,
  outcome: ExecutorOutcome,
): Promise<ActionProposal | undefined> {
  return updateProposal(id, externalOutcomePatch(p, effect, outcome));
}

/* -------------------------------- execute -------------------------------- */

/**
 * Apply a proposal's declarative effect against the object store. Only
 * approved proposals execute — a denied or already-executed proposal cannot
 * be re-run. Update/delete snapshot prior state so the action can be undone.
 *
 * The whole approved-check → authorize → apply → resolve sequence runs under
 * the proposals lock with a fresh read, so two tabs that both hold this
 * proposal as `approved` cannot both apply its effect: the second sees the
 * first's resolved status and is refused. Async external work is claimed by
 * moving to `executing` inside the lock; the awaited outcome is recorded by a
 * later locked update.
 */
export async function execute(id: string): Promise<ActionProposal | undefined> {
  let result: ActionProposal | undefined;
  interface AsyncWork {
    promise: Promise<ExecutorOutcome | string | void>;
    proposal: ActionProposal;
    effect: ProposalEffect;
  }
  let asyncWork: AsyncWork | null = null;
  await mutateProposals((list) => {
    const p = list.find((x) => x.id === id);
    if (!p) {
      result = undefined;
      return list;
    }
    result = p;
    if (p.status !== "approved") {
      record({
        type: "ai.refused",
        app: p.app,
        summary: `Execution refused (${p.status}): ${p.summary}`,
        detail: "Only approved proposals execute; denied or resolved ones cannot re-run.",
      });
      return list;
    }
    // The last gate before mutation — covers the trusted auto-run path too.
    const verdict = authorizeProposal({
      app: p.app,
      actionType: p.actionType,
      effect: p.effect,
      capabilities: capsFor(p.app),
    });
    if (!verdict.allowed) {
      record({
        type: "ai.refused",
        app: p.app,
        summary: `Execution refused by Security Core: ${p.summary}`,
        detail: verdict.reason,
      });
      result = { ...p, status: "denied", resolvedAt: Date.now(), error: verdict.reason };
      return list.map((x) => (x.id === id ? result! : x));
    }
    const { effect } = p;
    try {
      let resultId: string | undefined;
      let undo: EffectUndo | undefined;
      switch (effect.kind) {
        case "create": {
          if (!effect.objectType) throw new Error("create effect needs an objectType");
          const obj = createObject({
            type: effect.objectType,
            title: effect.payload?.title ?? "Untitled",
            body: effect.payload?.body,
            tags: effect.payload?.tags,
            task:
              effect.objectType === "task"
                ? { done: effect.payload?.done ?? false, priority: "normal" }
                : undefined,
            card: effect.objectType === "card" ? { links: [] } : undefined,
            project:
              effect.objectType === "project"
                ? { summary: effect.payload?.body ?? "" }
                : undefined,
          });
          resultId = obj.id;
          undo = { kind: "delete-created", targetId: obj.id };
          break;
        }
        case "update": {
          if (!effect.targetId) throw new Error("update effect needs a targetId");
          const target = getObject(effect.targetId);
          if (!target) throw new Error("target object no longer exists");
          // Stale-base detection: the monotonic revision is the version token
          // (same-ms writes are distinguishable); updatedAt remains as the
          // fallback for proposals persisted before revisions existed.
          if (effect.baseRev !== undefined) {
            if ((target.rev ?? 0) !== effect.baseRev) {
              throw new Error(
                "the object changed after this was proposed — re-propose against the current version",
              );
            }
          } else if (effect.baseUpdatedAt !== undefined && target.updatedAt !== effect.baseUpdatedAt) {
            throw new Error(
              "the object changed after this was proposed — re-propose against the current version",
            );
          }
          // Build the patch conditionally: only keys the effect explicitly
          // carries are written. Spreading absent keys as `undefined` is what
          // used to wipe titles and tags on approval.
          const patch: Partial<SystemObject> = {};
          const payload = effect.payload ?? {};
          if ("title" in payload) patch.title = payload.title;
          if ("body" in payload) patch.body = payload.body;
          if ("tags" in payload) patch.tags = payload.tags;
          if ("done" in payload && target.type === "task" && target.task) {
            patch.task = { ...target.task, done: payload.done ?? target.task.done };
          }
          undo = {
            kind: "restore-fields",
            targetId: target.id,
            snapshot: {
              title: target.title,
              body: target.body,
              tags: target.tags,
              task: target.task,
            },
          };
          updateObject(effect.targetId, patch);
          resultId = effect.targetId;
          break;
        }
        case "delete": {
          if (!effect.targetId) throw new Error("delete effect needs a targetId");
          const target = getObject(effect.targetId);
          if (target) undo = { kind: "recreate-object", targetId: target.id, snapshot: target };
          deleteObject(effect.targetId);
          resultId = effect.targetId;
          break;
        }
        case "external": {
          const executor = externalExecutors.get(p.actionType);
          if (!executor) {
            // No runtime backs this external action yet — record the approval
            // honestly instead of claiming a broker call that never happened.
            record({
              type: "ai.executed",
              app: p.app,
              summary: `External action approved (no runtime): ${effect.externalSummary ?? p.summary}`,
              detail: "Recorded only — no external runtime is connected in this build.",
            });
            result = { ...p, status: "executed", resolvedAt: Date.now() };
            return list.map((x) => (x.id === id ? result! : x));
          }
          let ran: ExecutorOutcome | string | void | Promise<ExecutorOutcome | string | void>;
          try {
            ran = executor(p);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result = { ...p, ...externalOutcomePatch(p, effect, { status: "failed", detail: message }) };
            return list.map((x) => (x.id === id ? result! : x));
          }
          if (ran instanceof Promise) {
            // Async external work: claim `executing` inside the lock and
            // record completion only when the awaited work settles. Broker
            // never reports success the instant it dispatched. `executing` is
            // not `approved`, so a re-entry is refused and the effect cannot
            // double-run or be undone mid-flight.
            record({
              type: "system.event",
              app: p.app,
              summary: `External action dispatched: ${effect.externalSummary ?? p.summary}`,
              detail: "Completion will be recorded when the work finishes.",
            });
            result = { ...p, status: "executing" };
            asyncWork = { promise: ran, proposal: p, effect };
            return list.map((x) => (x.id === id ? result! : x));
          }
          result = { ...p, ...externalOutcomePatch(p, effect, normalizeOutcome(ran)) };
          return list.map((x) => (x.id === id ? result! : x));
        }
      }
      record({
        type: "ai.executed",
        app: p.app,
        summary: `Executed: ${p.summary}`,
      });
      result = { ...p, status: "executed", resolvedAt: Date.now(), resultId, undo };
      return list.map((x) => (x.id === id ? result! : x));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record({
        type: "system.event",
        app: p.app,
        summary: `Action failed: ${p.summary}`,
        detail: message,
      });
      result = { ...p, status: "failed", resolvedAt: Date.now(), error: message };
      return list.map((x) => (x.id === id ? result! : x));
    }
  });
  // TS control flow cannot see the assignment inside the mutator callback.
  const work = asyncWork as AsyncWork | null;
  if (work) {
    const { promise, proposal, effect } = work;
    promise
      .then((v) => finishExternal(id, proposal, effect, normalizeOutcome(v)))
      .catch((err) =>
        finishExternal(id, proposal, effect, {
          status: "failed",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
  }
  return result;
}

/**
 * Undo an executed proposal from the snapshot captured at execution — the
 * declarative-effect promise made real. Once undone, it cannot re-run. The
 * check-and-mark runs under the proposals lock so two tabs cannot both undo.
 */
export async function undoProposal(id: string): Promise<ActionProposal | undefined> {
  let result: ActionProposal | undefined;
  await mutateProposals((list) => {
    const p = list.find((x) => x.id === id);
    result = p;
    if (!p || p.status !== "executed" || !p.undo || p.undoneAt) return list;
    const { undo } = p;
    try {
      if (undo.kind === "delete-created" && undo.targetId) {
        deleteObject(undo.targetId);
      } else if (undo.kind === "restore-fields" && undo.targetId) {
        const snapshot = undo.snapshot as Partial<SystemObject>;
        if (!getObject(undo.targetId)) throw new Error("the object no longer exists");
        updateObject(undo.targetId, {
          title: snapshot.title,
          body: snapshot.body,
          tags: snapshot.tags,
          task: snapshot.task,
        });
      } else if (undo.kind === "recreate-object") {
        const snapshot = undo.snapshot as SystemObject;
        if (getObject(snapshot.id)) throw new Error("an object with this id already exists");
        restoreObject(snapshot);
      }
      record({ type: "ai.undone", app: p.app, summary: `Undone: ${p.summary}` });
      result = { ...p, undoneAt: Date.now() };
      return list.map((x) => (x.id === id ? result! : x));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record({
        type: "system.event",
        app: p.app,
        summary: `Undo failed: ${p.summary}`,
        detail: message,
      });
      return list;
    }
  });
  return result;
}

/**
 * Boot recovery: a proposal left in `executing` means the session ended while
 * an async external effect was in flight — we cannot know whether it finished,
 * so mark it failed (honest, and re-proposable) rather than leaving it in
 * limbo forever. Called once at startup.
 */
export async function recoverDanglingProposals(): Promise<void> {
  if (!loadProposals().some((p) => p.status === "executing")) return;
  const dangling: ActionProposal[] = [];
  await mutateProposals((list) =>
    list.map((p) => {
      if (p.status !== "executing") return p;
      dangling.push(p);
      return {
        ...p,
        status: "failed" as const,
        resolvedAt: Date.now(),
        error:
          "The action was interrupted — the session ended before it finished. Re-propose if it is still needed.",
      };
    }),
  );
  for (const p of dangling) {
    record({
      type: "system.event",
      app: p.app,
      summary: `Broker: interrupted action marked failed — ${p.summary}`,
    });
  }
}

export async function clearResolvedProposals(): Promise<void> {
  let cleared = 0;
  let undoable = 0;
  await mutateProposals((list) => {
    const kept = list.filter((p) => p.status === "pending");
    cleared = list.length - kept.length;
    undoable = list.filter((p) => p.status === "executed" && p.undo && !p.undoneAt).length;
    return cleared === 0 ? list : kept;
  });
  if (cleared === 0) return;
  // Clearing destroys undo snapshots — that belongs on the record.
  record({
    type: "system.event",
    summary: `Broker: ${cleared} resolved proposal${cleared === 1 ? "" : "s"} cleared`,
    detail: undoable
      ? `${undoable} executed proposal${undoable === 1 ? "" : "s"} lost their undo snapshots`
      : undefined,
  });
}

export function countByStatus(): Record<ProposalStatus, number> {
  const out: Record<ProposalStatus, number> = {
    pending: 0,
    approved: 0,
    executing: 0,
    denied: 0,
    executed: 0,
    failed: 0,
  };
  for (const p of loadProposals()) out[p.status] += 1;
  return out;
}

/* -------------------------- Trusted actions ----------------------------- */

function loadTrusted(): TrustedAction[] {
  return storage.get<TrustedAction[]>(StoreKeys.trustedActions, [], Array.isArray);
}
function saveTrusted(list: TrustedAction[]): void {
  storage.set(StoreKeys.trustedActions, list);
}

export function getTrustedActions(): TrustedAction[] {
  return loadTrusted();
}

function enabledTrustedActionFor(
  app: AppId,
  actionType: string,
  effect: ProposalEffect,
): TrustedAction | undefined {
  const match = loadTrusted().find(
    (t) =>
      t.enabled &&
      t.app === app &&
      t.actionType === actionType &&
      trustedActionCovers(t, effect),
  );
  if (!match) return undefined;
  // F3: auto-run only when the capability itself is in the `trusted` tier, so
  // an enabled Trusted Action can never silently escalate a capability the user
  // left in Writable-with-approval. Otherwise fall back to per-approval.
  if (!trustedTierPermits({ app, actionType, capabilities: capsFor(app) })) return undefined;
  return match;
}

export interface DefineTrustedInput {
  app: AppId;
  name: string;
  actionType: string;
  scope: string;
  trigger: string;
  dataTouched: string;
  undoNotes: string;
  effectKinds?: TrustedAction["effectKinds"];
}

export function defineTrustedAction(input: DefineTrustedInput): TrustedAction {
  const action: TrustedAction = {
    id: makeId("trusted"),
    enabled: false,
    createdAt: Date.now(),
    ...input,
  };
  saveTrusted([...loadTrusted(), action]);
  record({
    type: "trusted_action.changed",
    app: input.app,
    summary: `Trusted action defined: ${input.name}`,
    detail: `${input.scope} · trigger: ${input.trigger}`,
  });
  return action;
}

export function setTrustedEnabled(id: string, enabled: boolean): void {
  const action = loadTrusted().find((t) => t.id === id);
  if (!action) return;
  saveTrusted(loadTrusted().map((t) => (t.id === id ? { ...t, enabled } : t)));
  record({
    type: "trusted_action.changed",
    app: action.app,
    summary: `Trusted action ${enabled ? "enabled" : "disabled"}: ${action.name}`,
    detail: enabled ? `Now runs without asking within: ${action.scope}` : undefined,
  });
}

export function removeTrustedAction(id: string): void {
  const action = loadTrusted().find((t) => t.id === id);
  if (!action) return;
  saveTrusted(loadTrusted().filter((t) => t.id !== id));
  record({
    type: "trusted_action.changed",
    app: action.app,
    summary: `Trusted action removed: ${action.name}`,
  });
}

/**
 * Seed a couple of trusted-action *definitions* (disabled by default) so the
 * escalation surface is concrete. Nothing runs until the user enables it.
 */
export function seedIfEmpty(): void {
  if (loadTrusted().length > 0) return;
  saveTrusted([
    {
      id: "trusted-index",
      app: "files",
      name: "Index new files on add",
      actionType: "files.index",
      scope: "The local file index only",
      trigger: "A new file entry is created",
      dataTouched: "File metadata and derived summaries",
      undoNotes: "Clear the summary; no source bytes are changed",
      effectKinds: ["update"],
      enabled: false,
      createdAt: Date.now(),
    },
    {
      id: "trusted-preview",
      app: "writer",
      name: "Render Markdown preview",
      actionType: "writer.preview",
      scope: "The open document, locally",
      trigger: "Preview mode is toggled",
      dataTouched: "Nothing is written; render is in-memory",
      undoNotes: "Switch back to write mode",
      effectKinds: ["update"],
      enabled: false,
      createdAt: Date.now(),
    },
  ]);
}

/* ------------------------------ Reactivity ------------------------------ */

export function subscribe(fn: () => void): () => void {
  const u1 = storage.subscribe(StoreKeys.proposals, fn);
  const u2 = storage.subscribe(StoreKeys.trustedActions, fn);
  return () => {
    u1();
    u2();
  };
}
