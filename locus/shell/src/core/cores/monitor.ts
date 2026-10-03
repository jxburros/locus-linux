/*
 * Monitor Core — the personal observability layer (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: watches, conditions, triggers, health checks, status changes, stale
 * items, overdue work, recurring evaluations, and alert history. It watches
 * user-chosen conditions across other Cores and tells Notification Core when
 * attention is needed — it observes and triggers; other Cores own the domain
 * state (overdue math comes from Cardspoke, cadence from People, dates from
 * Time). Watches are declarative: a source, a condition, a frequency, a
 * severity, an optional cooldown and escalation.
 *
 * The evaluator runs as a job on Time Core's one scheduler (no private
 * setInterval, no multi-tab double-fire). Alerting is edge-triggered with a
 * trigger *fingerprint*: a new overdue task during an existing warning still
 * alerts, repeated file changes each alert (event-style, no fake recovery),
 * and unchanged conditions never re-serialize the watch array. Deleted
 * targets turn the watch "missing" and disable it instead of warning forever.
 */

import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { emit } from "../events";
import { deliver } from "./notification";
import { getObject, objectsOfType } from "../objects";
import { registerScheduledJob, daysSince } from "./time";
import { overdueTasks } from "./cardspoke";
import { dueFollowUps } from "./people";
import { redactText } from "./secrets";
import { registerExternalExecutor, type ExecutorOutcome } from "../broker";
import { proposeThroughCore } from "./ai";
import type { ActionProposal } from "@/types";

export type WatchType =
  | "storage"
  | "task-deadline"
  | "file-change"
  | "stale-item"
  | "contact-cadence"
  | "webpage";
export type WatchStatus = "ok" | "warning" | "critical" | "paused" | "pending" | "missing";
export type WatchSeverity = "info" | "warning" | "critical";

export interface Watch {
  id: string;
  name: string;
  type: WatchType;
  /** Per-type parameters. */
  params: {
    /** storage: alert above this many bytes (default ~2.5 MB of the ~5 MB budget). */
    thresholdBytes?: number;
    /** file-change / stale-item: the object to watch. */
    objectId?: string;
    /** contact-cadence: days without contact before alerting. */
    days?: number;
    /** stale-item: days without an update before the item counts as stale. */
    staleDays?: number;
    /** webpage: the page to check. */
    url?: string;
    /** webpage: user opted into live reachability checks (HEAD fetch). */
    checkEnabled?: boolean;
  };
  frequencyMs: number;
  severity: WatchSeverity;
  status: WatchStatus;
  enabled: boolean;
  /** Snoozed watches stay defined but are not evaluated until this passes. */
  snoozedUntil?: number;
  /** Minimum ms between alert notifications (cooldown). */
  minIntervalMs?: number;
  /** Escalate warning → critical after this many consecutive alerting passes. */
  escalateAfterFails?: number;
  consecutiveFails?: number;
  /** What the last alert was about — a new cause re-alerts even mid-warning. */
  lastFingerprint?: string;
  lastNotifiedAt?: number;
  /** Kept for older persisted data; live "checked" time is volatile. */
  lastChecked?: number;
  lastEvent?: string;
  lastEventAt?: number;
  /** Baselines the evaluator compares against (e.g. a file's updatedAt). */
  snapshot?: { updatedAt?: number };
  createdBy: string;
  createdAt: number;
}

export interface WatchEvent {
  id: string;
  watchId: string;
  watchName: string;
  at: number;
  status: WatchStatus;
  message: string;
}

const EVENT_LIMIT = 100;
let seq = 0;
function makeId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

let watchCache: Watch[] | null = null;
let eventCache: WatchEvent[] | null = null;

// Volatile per-tab state: when each watch was last evaluated (persisting it
// every pass was pure churn), and in-flight webpage checks.
const lastCheckedMap = new Map<string, number>();
const inFlightChecks = new Set<string>();

function loadWatches(): Watch[] {
  if (watchCache === null) watchCache = storage.get<Watch[]>(StoreKeys.monitorWatches, []);
  return watchCache;
}
function saveWatches(next: Watch[]): void {
  watchCache = next;
  storage.set(StoreKeys.monitorWatches, next);
}
function loadEvents(): WatchEvent[] {
  if (eventCache === null) eventCache = storage.get<WatchEvent[]>(StoreKeys.monitorEvents, []);
  return eventCache;
}
function saveEvents(next: WatchEvent[]): void {
  eventCache = next.slice(0, EVENT_LIMIT);
  storage.set(StoreKeys.monitorEvents, eventCache);
}

export function listWatches(): Watch[] {
  return loadWatches();
}
export function watchEvents(): WatchEvent[] {
  return loadEvents();
}
/** When this watch was last evaluated in this tab (volatile by design). */
export function lastCheckedAt(id: string): number | undefined {
  return lastCheckedMap.get(id) ?? loadWatches().find((w) => w.id === id)?.lastChecked;
}
export function subscribeWatches(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.monitorWatches, () => {
    watchCache = storage.get<Watch[]>(StoreKeys.monitorWatches, []);
    fn();
  });
}
export function subscribeWatchEvents(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.monitorEvents, () => {
    eventCache = storage.get<WatchEvent[]>(StoreKeys.monitorEvents, []);
    fn();
  });
}

/* ---------------------------------- CRUD ----------------------------------- */

const OBJECT_WATCH_TYPES: WatchType[] = ["file-change", "stale-item"];

export function createWatch(input: {
  name: string;
  type: WatchType;
  params?: Watch["params"];
  frequencyMs?: number;
  severity?: WatchSeverity;
  minIntervalMs?: number;
  escalateAfterFails?: number;
  createdBy?: string;
}): Watch {
  const params = input.params ?? {};
  // AI-origin watches must not write directly — that would bypass the manifest's
  // approval requirement. The AI path is a brokered proposal (see AI Core); a
  // direct createWatch({createdBy:"ai"}) is refused here.
  if (input.createdBy === "ai") {
    throw new Error("AI-created watches must go through an approved proposal, not createWatch directly");
  }
  if (OBJECT_WATCH_TYPES.includes(input.type)) {
    if (!params.objectId || !getObject(params.objectId)) {
      throw new Error("Choose an existing object to watch");
    }
  }
  if (input.type === "webpage" && !params.url?.trim()) {
    throw new Error("A webpage watch needs a URL");
  }
  const w: Watch = {
    id: makeId("w"),
    name: input.name,
    type: input.type,
    params,
    frequencyMs: input.frequencyMs ?? 60_000,
    severity: input.severity ?? "warning",
    status: input.type === "webpage" && !params.checkEnabled ? "pending" : "ok",
    enabled: true,
    minIntervalMs: input.minIntervalMs,
    escalateAfterFails: input.escalateAfterFails,
    createdBy: input.createdBy ?? "user",
    createdAt: Date.now(),
  };
  if (w.type === "file-change" && w.params.objectId) {
    const obj = getObject(w.params.objectId);
    w.snapshot = { updatedAt: obj?.updatedAt };
  }
  saveWatches([w, ...loadWatches()]);
  record({ type: "system.event", summary: `Monitor Core: watch created — ${w.name} (${w.type})` });
  return w;
}

/**
 * The AI path to a watch (Wave 3): a brokered monitor.createWatch proposal —
 * never a direct write. The watch spec travels as structured executor input
 * (redacted at persistence); on approval, the executor registered in
 * initMonitorCore validates it again and creates the watch with an
 * "ai-approved" provenance. The registry's old advice to call
 * createWatch({createdBy:"ai"}) directly is refused by createWatch itself.
 */
export async function requestWatchCreation(input: {
  name: string;
  type: WatchType;
  params?: Watch["params"];
  frequencyMs?: number;
  severity?: WatchSeverity;
  purpose?: string;
}): Promise<ActionProposal | null> {
  if (!input.name.trim()) return null;
  return proposeThroughCore("monitor", {
    app: "monitor",
    actionType: "monitor.createWatch",
    summary: `Create watch “${input.name}” (${input.type})`,
    detail: input.purpose ? `Purpose: ${input.purpose}` : undefined,
    effect: {
      kind: "external",
      externalSummary: `Create a ${input.type} watch named “${input.name}”`,
      readOnly: false,
      payload: { title: input.name },
      input: {
        type: input.type,
        params: input.params ?? {},
        frequencyMs: input.frequencyMs,
        severity: input.severity,
      },
    },
  });
}

const WATCH_TYPES: WatchType[] = [
  "storage",
  "task-deadline",
  "file-change",
  "stale-item",
  "contact-cadence",
  "webpage",
];

/** Edit a watch after creation — name, severity, frequency, params, limits. */
export function updateWatch(
  id: string,
  patch: Partial<
    Pick<
      Watch,
      "name" | "severity" | "frequencyMs" | "params" | "minIntervalMs" | "escalateAfterFails"
    >
  >,
): Watch | undefined {
  let updated: Watch | undefined;
  saveWatches(
    loadWatches().map((w) => {
      if (w.id !== id) return w;
      updated = { ...w, ...patch, params: { ...w.params, ...(patch.params ?? {}) } };
      return updated;
    }),
  );
  if (updated) {
    lastCheckedMap.delete(id);
    record({ type: "system.event", summary: `Monitor Core: watch updated — ${updated.name}` });
  }
  return updated;
}

/** Pause mutes evaluation but keeps the status as it was — resuming a watch
    whose condition is still true does NOT re-alert (edge stays edge). */
export function setWatchEnabled(id: string, enabled: boolean): void {
  saveWatches(loadWatches().map((w) => (w.id === id ? { ...w, enabled } : w)));
}

/** Snooze a watch: it stays defined but is skipped until the time passes. */
export function snoozeWatch(id: string, minutes: number): void {
  const until = Date.now() + minutes * 60_000;
  const w = loadWatches().find((x) => x.id === id);
  saveWatches(loadWatches().map((x) => (x.id === id ? { ...x, snoozedUntil: until } : x)));
  if (w) record({ type: "system.event", summary: `Monitor Core: watch snoozed ${minutes}m — ${w.name}` });
}

export function deleteWatch(id: string): void {
  const w = loadWatches().find((x) => x.id === id);
  saveWatches(loadWatches().filter((x) => x.id !== id));
  lastCheckedMap.delete(id);
  if (w) record({ type: "system.event", summary: `Monitor Core: watch deleted — ${w.name}` });
}

/* -------------------------------- evaluation -------------------------------- */

interface EvalResult {
  status: WatchStatus;
  message?: string;
  /** What this alert is about; a change re-alerts even during a warning. */
  fingerprint?: string;
  snapshot?: Watch["snapshot"];
  /** Event-style results alert on every occurrence and do not hold status. */
  eventStyle?: boolean;
}

function alertStatus(w: Watch): WatchStatus {
  return w.severity === "critical" ? "critical" : "warning";
}

function evaluate(w: Watch): EvalResult {
  switch (w.type) {
    case "storage": {
      const bytes = storage.estimateBytes();
      const threshold = w.params.thresholdBytes ?? 2_500_000;
      if (bytes > threshold) {
        return {
          status: alertStatus(w),
          fingerprint: "over-threshold",
          message: `Local storage at ${(bytes / 1024).toFixed(0)} KB (threshold ${(threshold / 1024).toFixed(0)} KB)`,
        };
      }
      return { status: "ok" };
    }
    case "task-deadline": {
      // Overdue math belongs to Cardspoke Core (local calendar, F2).
      const overdue = overdueTasks();
      if (overdue.length > 0) {
        return {
          status: alertStatus(w),
          fingerprint: overdue.map((t) => t.id).sort().join(","),
          message: `${overdue.length} task${overdue.length === 1 ? "" : "s"} overdue: ${overdue
            .slice(0, 3)
            .map((t) => `“${t.title}”`)
            .join(", ")}${overdue.length > 3 ? "…" : ""}`,
        };
      }
      return { status: "ok" };
    }
    case "file-change": {
      const obj = w.params.objectId ? getObject(w.params.objectId) : undefined;
      if (!obj) return { status: "missing", message: "The watched item no longer exists" };
      const baseline = w.snapshot?.updatedAt ?? obj.updatedAt;
      if (obj.updatedAt > baseline) {
        // Event-style: record + notify + rebaseline. No fake "back to
        // normal" afterwards, and the next change alerts again.
        return {
          status: "ok",
          eventStyle: true,
          message: `“${obj.title}” changed`,
          snapshot: { updatedAt: obj.updatedAt },
        };
      }
      return { status: "ok", snapshot: { updatedAt: baseline } };
    }
    case "stale-item": {
      const obj = w.params.objectId ? getObject(w.params.objectId) : undefined;
      if (!obj) return { status: "missing", message: "The watched item no longer exists" };
      const staleDays = w.params.staleDays ?? 14;
      const idleDays = daysSince(obj.updatedAt);
      if (idleDays >= staleDays) {
        return {
          status: alertStatus(w),
          fingerprint: `stale:${obj.id}`,
          message: `“${obj.title}” has not changed in ${idleDays} day${idleDays === 1 ? "" : "s"}`,
        };
      }
      return { status: "ok" };
    }
    case "contact-cadence": {
      const stale = dueFollowUps(w.params.days ?? 30);
      if (stale.length > 0) {
        return {
          status: alertStatus(w),
          fingerprint: stale.map((c) => c.id).sort().join(","),
          message: `${stale.length} contact${stale.length === 1 ? "" : "s"} due for follow-up: ${stale
            .slice(0, 3)
            .map((c) => c.name)
            .join(", ")}${stale.length > 3 ? "…" : ""}`,
        };
      }
      return { status: "ok" };
    }
    case "webpage":
      // Reachability checks are async and opt-in; the sync pass only decides
      // whether one should start (see checkWebpage). Without opt-in: pending.
      return { status: w.params.checkEnabled ? w.status : "pending" };
  }
}

function pushEvent(w: Watch, status: WatchStatus, message: string): void {
  // Redact before persisting to Monitor history — watch names and messages
  // interpolate task/contact/doc titles that can carry pasted secrets, and only
  // the Notification/Audit copies were redaction-passed before.
  saveEvents([
    {
      id: makeId("we"),
      watchId: w.id,
      watchName: redactText(w.name),
      at: Date.now(),
      status,
      message: redactText(message),
    },
    ...loadEvents(),
  ]);
}

function alert(w: Watch, status: WatchStatus, message: string, now: number): boolean {
  if (w.minIntervalMs && w.lastNotifiedAt && now - w.lastNotifiedAt < w.minIntervalMs) {
    return false; // cooldown: status still updates, the alert waits
  }
  deliver({
    title: `Monitor: ${w.name}`,
    detail: message,
    source: "Monitor",
    priority: status === "critical" ? "critical" : "high",
  });
  record({
    type: "monitor.triggered",
    summary: `Monitor triggered: ${w.name}`,
    detail: message,
    skipEmit: true, // the typed bus event below carries the watch + message
  });
  emit("monitor.triggered", { watch: w, message });
  pushEvent(w, status, message);
  return true;
}

/** Are two watches materially different (worth re-serializing the array)? */
function materiallyEqual(a: Watch, b: Watch): boolean {
  return (
    a.status === b.status &&
    a.enabled === b.enabled &&
    a.lastEvent === b.lastEvent &&
    a.lastEventAt === b.lastEventAt &&
    a.lastFingerprint === b.lastFingerprint &&
    a.lastNotifiedAt === b.lastNotifiedAt &&
    (a.consecutiveFails ?? 0) === (b.consecutiveFails ?? 0) &&
    a.snapshot?.updatedAt === b.snapshot?.updatedAt
  );
}

function runDueChecks(): void {
  const now = Date.now();
  let changed = false;
  // Re-read fresh so this pass evaluates (and later saves over) the current
  // persisted watches — a stale module cache in a background evaluator tab
  // could otherwise clobber edits made in another tab.
  watchCache = storage.get<Watch[]>(StoreKeys.monitorWatches, []);
  const next = watchCache.map((w) => {
    try {
    if (!w.enabled) return w;
    if ((w.snoozedUntil ?? 0) > now) return w;
    const last = lastCheckedMap.get(w.id) ?? 0;
    if (now - last < w.frequencyMs) return w;
    lastCheckedMap.set(w.id, now);

    if (w.type === "webpage") {
      if (w.params.checkEnabled) checkWebpage(w);
      return w;
    }

    const result = evaluate(w);
    let out: Watch = { ...w };

    if (result.status === "missing") {
      // The target is gone: say so once, then stand down instead of warning
      // forever about an object nobody can bring back.
      out = { ...out, status: "missing", enabled: false, lastEvent: result.message, lastEventAt: now };
      const notified = alert(out, "warning", `${result.message} — the watch was disabled`, now);
      // The disable must reach history even when the alert is in cooldown.
      if (!notified) pushEvent(out, "warning", `${result.message} — the watch was disabled`);
    } else if (result.eventStyle && result.message) {
      const notified = alert(w, alertStatus(w), result.message, now);
      out = notified
        ? {
            ...out,
            status: "ok",
            snapshot: result.snapshot ?? w.snapshot,
            lastEvent: result.message,
            lastEventAt: now,
            lastNotifiedAt: now,
            consecutiveFails: 0,
          }
        : // Cooldown: keep the old snapshot so the event is re-detected and
          // the alert retries once the cooldown expires — waits, not dropped.
          { ...out, consecutiveFails: 0 };
    } else {
      const alerting = result.status === "warning" || result.status === "critical";
      const wasAlerting = w.status === "warning" || w.status === "critical";
      // Capped so a steadily-alerting watch stops re-serializing the array
      // once the count can no longer change anything.
      const fails = alerting
        ? Math.min((w.consecutiveFails ?? 0) + 1, w.escalateAfterFails ?? 1)
        : 0;
      let status = result.status;
      // Escalation: enough consecutive alerting passes upgrade the severity.
      if (alerting && w.escalateAfterFails && fails >= w.escalateAfterFails) {
        status = "critical";
      }
      const fingerprintChanged =
        alerting && !!result.fingerprint && result.fingerprint !== w.lastFingerprint;
      const statusEscalated = alerting && (!wasAlerting || status !== w.status);

      out = {
        ...out,
        status,
        snapshot: result.snapshot ?? w.snapshot,
        consecutiveFails: fails,
        lastFingerprint: alerting ? result.fingerprint ?? w.lastFingerprint : undefined,
      };

      if ((statusEscalated || fingerprintChanged) && result.message) {
        const notified = alert(out, status, result.message, now);
        out = notified
          ? {
              ...out,
              lastEvent: result.message,
              lastEventAt: now,
              lastNotifiedAt: now,
            }
          : // Cooldown: keep the previous status and fingerprint so this
            // escalation is re-detected and the alert retries after the
            // cooldown, instead of being consumed silently.
            { ...out, status: w.status, lastFingerprint: w.lastFingerprint };
      } else if (!alerting && wasAlerting) {
        pushEvent(w, "ok", "Back to normal");
        record({ type: "monitor.recovered", summary: `Monitor recovered: ${w.name}`, skipEmit: true });
        emit("monitor.recovered", { watch: w });
        out = { ...out, lastEvent: "Back to normal", lastEventAt: now };
      }
    }

    if (materiallyEqual(w, out)) return w;
    changed = true;
    return out;
    } catch (err) {
      // One malformed or throwing watch must not abort the whole pass — record
      // it and leave the watch untouched so every other watch still evaluates.
      record({
        type: "system.event",
        summary: `Monitor Core: watch “${w?.name ?? w?.id ?? "unknown"}” failed to evaluate — skipped this pass`,
        detail: err instanceof Error ? err.message : String(err),
      });
      return w;
    }
  });
  if (changed) saveWatches(next);
  emit("monitor.checked", { at: now });
}

/**
 * Opt-in webpage reachability: a HEAD fetch in no-cors mode. An opaque
 * response proves something answered; a network error means unreachable
 * *from this browser* — which is exactly what the message says. Full change
 * detection needs an engine with page access (Web Core's future).
 */
function checkWebpage(w: Watch): void {
  const url = w.params.url;
  if (!url || inFlightChecks.has(w.id)) return;
  inFlightChecks.add(w.id);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  fetch(url, {
    method: "HEAD",
    mode: "no-cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    signal: controller.signal,
  })
    .then(() => applyWebpageResult(w.id, url, "ok", "Reachable"))
    .catch(() =>
      applyWebpageResult(
        w.id,
        url,
        alertStatus(w),
        "Unreachable from this browser (network error, blocked, or offline)",
      ),
    )
    .finally(() => {
      window.clearTimeout(timer);
      inFlightChecks.delete(w.id);
    });
}

/**
 * Settle an async reachability result with the same state machine synchronous
 * watches get (Wave 3): stale-intent results are dropped (the watch was
 * paused, snoozed, or its URL edited while the fetch was in flight),
 * consecutive failures persist and escalate to critical after
 * escalateAfterFails passes, cooldown holds the alert without consuming the
 * transition, and recovery is recorded and emitted like every other watch.
 */
function applyWebpageResult(
  id: string,
  requestedUrl: string,
  status: WatchStatus,
  message: string,
): void {
  const now = Date.now();
  const w = loadWatches().find((x) => x.id === id);
  if (!w) return;
  // The user's intent changed while the fetch was in flight — drop the result.
  if (!w.enabled || (w.snoozedUntil ?? 0) > now || w.params.url !== requestedUrl) return;

  const alerting = status === "warning" || status === "critical";
  if (alerting) {
    const fails = Math.min((w.consecutiveFails ?? 0) + 1, w.escalateAfterFails ?? 1);
    let effective: WatchStatus = status;
    if (w.escalateAfterFails && fails >= w.escalateAfterFails) effective = "critical";
    const transition = w.status !== effective;
    let notifiedAt = w.lastNotifiedAt;
    if (transition) {
      const notified = alert(w, effective, `${w.params.url}: ${message}`, now);
      // Cooldown: keep the stored status unchanged so the next check
      // re-detects the transition and retries the alert — but persist the
      // failure count so escalation state survives the cooldown.
      if (!notified) {
        saveWatches(
          loadWatches().map((x) => (x.id === id ? { ...x, consecutiveFails: fails } : x)),
        );
        return;
      }
      notifiedAt = now;
    }
    saveWatches(
      loadWatches().map((x) =>
        x.id === id
          ? {
              ...x,
              status: effective,
              consecutiveFails: fails,
              lastEvent: message,
              lastEventAt: now,
              lastNotifiedAt: notifiedAt,
            }
          : x,
      ),
    );
    return;
  }

  const recovered = w.status === "warning" || w.status === "critical";
  if (recovered) {
    pushEvent(w, "ok", "Reachable again");
    record({ type: "monitor.recovered", summary: `Monitor recovered: ${w.name}`, skipEmit: true });
    emit("monitor.recovered", { watch: w });
  }
  if (w.status === status && w.lastEvent === message && (w.consecutiveFails ?? 0) === 0) return;
  saveWatches(
    loadWatches().map((x) =>
      x.id === id
        ? { ...x, status, consecutiveFails: 0, lastEvent: message, lastEventAt: now }
        : x,
    ),
  );
}

let started = false;

/** Boot the evaluator as a job on Time Core's one scheduler — no private
    setInterval, and the multi-tab election comes with it (F4). Also registers
    the executor that fulfills approved monitor.createWatch proposals. */
export function initMonitorCore(): void {
  if (started) return;
  started = true;
  // Keep the module caches warm even when no Monitor UI is mounted, so the
  // evaluator sees other tabs' writes rather than running on a stale cache.
  storage.subscribe(StoreKeys.monitorWatches, () => {
    watchCache = storage.get<Watch[]>(StoreKeys.monitorWatches, []);
  });
  storage.subscribe(StoreKeys.monitorEvents, () => {
    eventCache = storage.get<WatchEvent[]>(StoreKeys.monitorEvents, []);
  });
  registerExternalExecutor("monitor.createWatch", (proposal): ExecutorOutcome => {
    // Re-validate the structured input at execution — the definition-gated,
    // redacted `input` record is data, not trusted code.
    const input = proposal.effect.input ?? {};
    const name = proposal.effect.payload?.title?.trim();
    const type = input.type as WatchType;
    if (!name) return { status: "failed", detail: "The watch needs a name." };
    if (!WATCH_TYPES.includes(type)) {
      return { status: "failed", detail: `Unknown watch type “${String(input.type)}”.` };
    }
    try {
      const w = createWatch({
        name,
        type,
        params: (input.params as Watch["params"]) ?? {},
        frequencyMs: typeof input.frequencyMs === "number" ? input.frequencyMs : undefined,
        severity:
          input.severity === "info" || input.severity === "warning" || input.severity === "critical"
            ? input.severity
            : undefined,
        // Provenance: created by the AI THROUGH an approved proposal — the
        // direct createdBy:"ai" write path stays refused in createWatch.
        createdBy: "ai-approved",
      });
      return { status: "succeeded", resultId: w.id, detail: `Watch “${w.name}” created.` };
    } catch (err) {
      return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
  });
  registerScheduledJob("monitor-evaluator", 15_000, runDueChecks);
}

/** Force a full pass now (the Monitor app's “Check now”). */
export function checkAllNow(): void {
  lastCheckedMap.clear();
  runDueChecks();
}

/* ------------------------------ suggested watches --------------------------- */

export interface SuggestedWatch {
  name: string;
  type: WatchType;
  params?: Watch["params"];
  reason: string;
}

/** “Monitor this” starters based on what actually exists right now. */
export function suggestedWatches(): SuggestedWatch[] {
  const existing = new Set(loadWatches().map((w) => `${w.type}:${w.params.objectId ?? ""}`));
  const out: SuggestedWatch[] = [];
  if (!existing.has("storage:")) {
    out.push({
      name: "Local storage headroom",
      type: "storage",
      reason: "Everything lives in local storage — know before it fills up.",
    });
  }
  if (!existing.has("task-deadline:") && objectsOfType("task").some((t) => t.task?.due)) {
    out.push({
      name: "Overdue tasks",
      type: "task-deadline",
      reason: "Tasks with due dates exist — get an alert the day one slips.",
    });
  }
  const doc = objectsOfType("document")[0];
  if (doc && !existing.has(`file-change:${doc.id}`)) {
    out.push({
      name: `Changes to “${doc.title}”`,
      type: "file-change",
      params: { objectId: doc.id },
      reason: "Watch a document for edits from anywhere in the OS.",
    });
  }
  const project = objectsOfType("project")[0];
  if (project && !existing.has(`stale-item:${project.id}`)) {
    out.push({
      name: `“${project.title}” going stale`,
      type: "stale-item",
      params: { objectId: project.id, staleDays: 14 },
      reason: "Get told when a project sits untouched for two weeks.",
    });
  }
  return out;
}
