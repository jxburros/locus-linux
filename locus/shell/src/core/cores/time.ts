/*
 * Time Core — OS-wide time (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: time, dates, schedules, reminders, alarms, timers, recurrence, and
 * time-based triggers. "When" is a shared system concept: every app creates
 * reminders, attaches due dates, and fires time-based actions the same way,
 * instead of Tasks, Calendar, Monitor, and AI each inventing schedule logic.
 * Not a productivity app — Calendar, Tasks, and Dashboard are surfaces over it.
 *
 * Time Core is also the OS's *one scheduler process*: a single elected tick
 * (exactly one tab runs it — core/scheduler) fires due entries and drives the
 * periodic jobs other Cores register (registerScheduledJob), so Monitor does
 * not need a private setInterval. Each firing goes through Notification Core
 * (delivery, quiet-hours aware), the audit log (record), and any registered
 * listeners (reaction).
 *
 * Date correctness for the whole OS lives here too (shared foundation F2):
 * todayLocal / toLocalDay / daysSince use the local calendar, not UTC, and
 * recurrence advances by wall clock so a daily 8:00 alarm stays 8:00 across
 * DST transitions.
 */

import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { emit } from "../events";
import { startElectedInterval } from "../scheduler";
import { deliver } from "./notification";

export type TimeEntryKind = "alarm" | "timer" | "event" | "reminder" | "trigger";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface TimeEntry {
  id: string;
  kind: TimeEntryKind;
  label: string;
  /** When this entry fires (absolute ms). Timers keep their end time here too. */
  at: number;
  /** Original duration, for timers. */
  durationMs?: number;
  recurrence: Recurrence;
  /**
   * The original scheduled time a recurring entry's grid derives from.
   * `at` moves with every firing and snooze; the anchor never does — so a
   * monthly 31st clamps to Feb 28 and returns to Mar 31, and a snoozed
   * daily 8:00 alarm is still an 8:00 alarm tomorrow.
   */
  anchorAt?: number;
  /** Which app or Core created it. */
  source: string;
  /** Structured work the trigger carries for its consumer (durable triggers). */
  payload?: Record<string, unknown>;
  /** The Core or app that should react when this fires. */
  targetCore?: string;
  /** Idempotency key: creating a second unfired entry with the same key is a no-op. */
  dedupeKey?: string;
  /** Set once fired (non-recurring entries keep their history). */
  firedAt?: number;
  /** Most recent firing of a recurring entry, so it shows in history too. */
  lastFiredAt?: number;
  /** Set instead of a normal fire when the entry was found long past due. */
  missed?: boolean;
  /** Most recent occurrence of a RECURRING entry that fired as missed — the
      missed outcome one-shots keep in `missed` was previously lost when the
      grid advanced past a missed recurrence. */
  lastMissedAt?: number;
  createdAt: number;
}

const DAY = 86_400_000;
/** An entry found more than this far past due fires as "missed", not live. */
const MISSED_GRACE_MS = 30 * 60_000;
let seq = 0;
function makeId(): string {
  seq += 1;
  return `te-${Date.now().toString(36)}-${seq.toString(36)}`;
}

let cache: TimeEntry[] | null = null;

function load(): TimeEntry[] {
  if (cache === null) cache = storage.get<TimeEntry[]>(StoreKeys.timeEntries, []);
  return cache;
}

function save(next: TimeEntry[]): void {
  cache = next;
  storage.set(StoreKeys.timeEntries, next);
}

// Keep the module cache fresh even when no component in this tab subscribes —
// the scheduler tick must see writes from other tabs (F4: no last-writer-wins).
let cacheWatcherStarted = false;
function watchCache(): void {
  if (cacheWatcherStarted) return;
  cacheWatcherStarted = true;
  storage.subscribe(StoreKeys.timeEntries, () => {
    cache = storage.get<TimeEntry[]>(StoreKeys.timeEntries, []);
  });
}

export function getTimeEntries(): TimeEntry[] {
  return load();
}

export function subscribeTime(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.timeEntries, () => {
    cache = storage.get<TimeEntry[]>(StoreKeys.timeEntries, []);
    fn();
  });
}

/* --------------------------- local-date helpers (F2) ------------------------ */

/** The local calendar day of a timestamp as yyyy-mm-dd (NOT UTC). */
export function toLocalDay(ts: number | Date): string {
  const d = typeof ts === "number" ? new Date(ts) : ts;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's local calendar day as yyyy-mm-dd. */
export function todayLocal(): string {
  return toLocalDay(new Date());
}

/** Whole local calendar days elapsed since a timestamp (0 = same day). */
export function daysSince(ts: number, now: number = Date.now()): number {
  const a = new Date(ts);
  const b = new Date(now);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

/** Compare yyyy-mm-dd day strings: is `day` on or before `boundary`? */
export function onOrBeforeDay(day: string, boundary: string): boolean {
  return day <= boundary;
}

/** Compare yyyy-mm-dd day strings: is `day` on or after `boundary`? */
export function onOrAfterDay(day: string, boundary: string): boolean {
  return day >= boundary;
}

/* ------------------------------ now & format ------------------------------- */

export type HourCycle = "auto" | "12" | "24";

export function getHourCycle(): HourCycle {
  return storage.get<HourCycle>(StoreKeys.timeFormat, "auto");
}

export function setHourCycle(hc: HourCycle): void {
  storage.set(StoreKeys.timeFormat, hc);
}

export function formatTime(d: Date | number): string {
  const hc = getHourCycle();
  const date = typeof d === "number" ? new Date(d) : d;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(hc === "auto" ? {} : { hour12: hc === "12" }),
  });
}

export function formatDate(d: Date | number): string {
  const date = typeof d === "number" ? new Date(d) : d;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function formatDateTime(d: Date | number): string {
  return `${formatDate(d)} ${formatTime(d)}`;
}

/* --------------------------------- create ---------------------------------- */

export interface CreateTimeEntry {
  kind: TimeEntryKind;
  label: string;
  at: number;
  /** Recurrence grid anchor when the first fire deviates from the grid
      (e.g. a birthday reminder firing "shortly" because 9:00 passed).
      Defaults to `at`. */
  anchorAt?: number;
  durationMs?: number;
  recurrence?: Recurrence;
  source?: string;
  payload?: Record<string, unknown>;
  targetCore?: string;
  dedupeKey?: string;
}

export function createTimeEntry(input: CreateTimeEntry): TimeEntry {
  if (input.dedupeKey) {
    const existing = load().find((e) => e.dedupeKey === input.dedupeKey && !e.firedAt);
    if (existing) return existing;
  }
  const entry: TimeEntry = {
    id: makeId(),
    kind: input.kind,
    label: input.label,
    at: input.at,
    anchorAt: (input.recurrence ?? "none") !== "none" ? input.anchorAt ?? input.at : undefined,
    durationMs: input.durationMs,
    recurrence: input.recurrence ?? "none",
    source: input.source ?? "user",
    payload: input.payload,
    targetCore: input.targetCore,
    dedupeKey: input.dedupeKey,
    createdAt: Date.now(),
  };
  save([entry, ...load()]);
  record({
    type: "time.entry.created",
    summary: `Time Core: ${entry.kind} set — “${entry.label}” at ${formatDateTime(entry.at)}`,
  });
  return entry;
}

export function createAlarm(label: string, at: number, recurrence: Recurrence = "none"): TimeEntry {
  return createTimeEntry({ kind: "alarm", label, at, recurrence });
}

export function createTimer(label: string, durationMs: number): TimeEntry {
  return createTimeEntry({ kind: "timer", label, at: Date.now() + durationMs, durationMs });
}

export function createEvent(label: string, at: number, recurrence: Recurrence = "none"): TimeEntry {
  return createTimeEntry({ kind: "event", label, at, recurrence });
}

export function createReminder(
  label: string,
  at: number,
  source = "user",
  opts: { recurrence?: Recurrence; dedupeKey?: string } = {},
): TimeEntry {
  return createTimeEntry({
    kind: "reminder",
    label,
    at,
    source,
    recurrence: opts.recurrence,
    dedupeKey: opts.dedupeKey,
  });
}

/**
 * The timed-trigger API for other apps and Cores (directive: “API for other
 * apps to request timed triggers”). Triggers are durable: they persist the
 * work (payload + targetCore) and an idempotency key, and fire through the
 * same scheduler as everything else.
 */
export function requestTrigger(
  label: string,
  at: number,
  source: string,
  opts: {
    payload?: Record<string, unknown>;
    targetCore?: string;
    dedupeKey?: string;
    recurrence?: Recurrence;
  } = {},
): TimeEntry {
  return createTimeEntry({ kind: "trigger", label, at, source, ...opts });
}

/**
 * Move an entry to a new time — snooze, push back, or bring forward. Moves
 * the *pending occurrence* only: a recurring entry's grid (anchorAt) is
 * untouched, so snoozing today's 8:00 alarm ten minutes does not turn it
 * into an 8:10 alarm forever.
 */
export function rescheduleEntry(id: string, at: number): TimeEntry | undefined {
  let updated: TimeEntry | undefined;
  save(
    load().map((e) => {
      if (e.id !== id) return e;
      updated = { ...e, at, firedAt: undefined, missed: undefined };
      return updated;
    }),
  );
  if (updated) {
    record({
      type: "time.entry.rescheduled",
      summary: `Time Core: ${updated.kind} rescheduled — “${updated.label}” to ${formatDateTime(at)}`,
    });
  }
  return updated;
}

/** Snooze a fired (or pending) entry by N minutes — reuses reschedule. */
export function snoozeEntry(id: string, minutes = 10): TimeEntry | undefined {
  return rescheduleEntry(id, Date.now() + minutes * 60_000);
}

export function cancelTimeEntry(id: string): void {
  const entry = load().find((e) => e.id === id);
  save(load().filter((e) => e.id !== id));
  if (entry) {
    record({
      type: "time.entry.cancelled",
      summary: `Time Core: ${entry.kind} cancelled — “${entry.label}”`,
    });
  }
}

/**
 * Cancel every unfired entry carrying this idempotency key — how a Core
 * retracts durable entries it materialized (e.g. a deleted contact's
 * birthday reminder must not fire every year forever).
 */
export function cancelTimeEntriesByDedupeKey(dedupeKey: string): number {
  const matching = load().filter((e) => e.dedupeKey === dedupeKey && !e.firedAt);
  if (matching.length === 0) return 0;
  save(load().filter((e) => !(e.dedupeKey === dedupeKey && !e.firedAt)));
  for (const entry of matching) {
    record({
      type: "time.entry.cancelled",
      summary: `Time Core: ${entry.kind} cancelled — “${entry.label}”`,
    });
  }
  return matching.length;
}

/** Entries that have not fired yet, soonest first. */
export function upcomingEntries(): TimeEntry[] {
  return load()
    .filter((e) => !e.firedAt)
    .sort((a, b) => a.at - b.at);
}

/** Fired entries — recent history, latest first. Includes recurring entries
    that have fired at least once (lastFiredAt). */
export function firedEntries(): TimeEntry[] {
  return load()
    .filter((e) => e.firedAt || e.lastFiredAt)
    .sort((a, b) => (b.firedAt ?? b.lastFiredAt ?? 0) - (a.firedAt ?? a.lastFiredAt ?? 0));
}

/**
 * Upcoming commitments in plain language — the shape AI uses to reason about
 * deadlines and explain what's ahead, without reading raw entries.
 */
export function describeUpcoming(limit = 8): string[] {
  return upcomingEntries()
    .slice(0, limit)
    .map(
      (e) =>
        `${KIND_TITLES[e.kind]}: “${e.label}” — ${formatDateTime(e.at)}${
          e.recurrence !== "none" ? ` (repeats ${e.recurrence})` : ""
        }`,
    );
}

/* -------------------------------- recurrence -------------------------------- */

/**
 * Advance a recurring entry past `now` by the wall clock, not by fixed ms
 * multiples: a daily 8:00 alarm stays 8:00 local across DST transitions, a
 * monthly entry keeps its day-of-month (clamped to short months), and a
 * yearly Feb-29 entry falls on Feb 28 in non-leap years (explicit clamp rule).
 *
 * The grid walks from `anchor` (the original scheduled time), never from a
 * clamped or snoozed occurrence — a monthly 31st that clamped to Feb 28
 * returns to Mar 31 because the wanted day-of-month lives on the anchor.
 *
 * DST policy (explicit, not accidental):
 * - GAP (spring forward — the anchor's wall-clock time does not exist that
 *   day): the occurrence shifts forward to the first time that does exist
 *   (02:30 fires at 03:30), for THAT day only. The anchor's time-of-day is
 *   re-asserted on every step, so the shift never sticks to later days —
 *   which it previously did, because Date normalization accumulated.
 * - FOLD (fall back — the wall-clock time exists twice): the engine's
 *   disambiguation picks one offset; the entry fires exactly once (the tick
 *   marks it fired/advanced on the first firing, so a fold can never
 *   double-fire).
 */
export function nextOccurrence(
  at: number,
  recurrence: Recurrence,
  now: number,
  anchor: number = at,
): number {
  if (recurrence === "none") return at;
  const d = new Date(anchor);
  const wantedDate = d.getDate();
  const wantedMonth = d.getMonth();
  const anchorTime = {
    h: d.getHours(),
    m: d.getMinutes(),
    s: d.getSeconds(),
    ms: d.getMilliseconds(),
  };
  // Fast-forward daily/weekly so a years-old anchor converges in a few steps.
  if ((recurrence === "daily" || recurrence === "weekly") && d.getTime() <= now) {
    const step = recurrence === "daily" ? 1 : 7;
    const behindDays = Math.floor((now - d.getTime()) / DAY);
    if (behindDays > step) d.setDate(d.getDate() + Math.floor(behindDays / step) * step);
  }
  let guard = 0;
  while (d.getTime() <= now && guard < 4000) {
    guard += 1;
    if (recurrence === "daily") {
      d.setDate(d.getDate() + 1);
    } else if (recurrence === "weekly") {
      d.setDate(d.getDate() + 7);
    } else if (recurrence === "monthly") {
      // Advance from the 1st so a 31st never rolls into the month after next,
      // then clamp to the target month's length.
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(wantedDate, daysInMonth(d.getFullYear(), d.getMonth())));
    } else if (recurrence === "yearly") {
      d.setDate(1);
      d.setFullYear(d.getFullYear() + 1);
      d.setMonth(wantedMonth);
      d.setDate(Math.min(wantedDate, daysInMonth(d.getFullYear(), wantedMonth)));
    }
    // Re-assert the anchor's wall-clock time-of-day on every step (the gap/
    // fold policy above). Without this, one spring-forward normalization
    // (02:30 → 03:30) persisted into every later occurrence.
    d.setHours(anchorTime.h, anchorTime.m, anchorTime.s, anchorTime.ms);
  }
  return d.getTime();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/* --------------------- durable dispatch outbox (Wave 3) ---------------------- */

/*
 * Triggers that carry work for a target Core used to be fire-and-forget: the
 * entry was marked fired whether or not the consumer was registered, and a
 * throwing consumer was swallowed with no retry. The outbox makes delivery
 * durable: every targetCore firing persists a dispatch record BEFORE consumers
 * run, the registered consumer acknowledges it by returning normally, failed
 * deliveries retry with backoff, and deliveries that keep failing move to a
 * visible dead-letter state instead of vanishing.
 */

export type DispatchStatus = "pending" | "acked" | "dead";

export interface DispatchRecord {
  id: string;
  entryId: string;
  targetCore: string;
  label: string;
  payload?: Record<string, unknown>;
  firedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  status: DispatchStatus;
  ackedAt?: number;
  /** The last delivery error, for the dead-letter record. */
  error?: string;
}

const DISPATCH_MAX_ATTEMPTS = 5;
const DISPATCH_RETRY_BASE_MS = 30_000;
const DISPATCH_ACKED_KEEP = 100;
const DISPATCH_DEAD_KEEP = 50;

type DispatchConsumer = (record: DispatchRecord) => void;
const dispatchConsumers = new Map<string, DispatchConsumer>();

function loadOutbox(): DispatchRecord[] {
  return storage.get<DispatchRecord[]>(StoreKeys.timeDispatchOutbox, [], Array.isArray);
}

function saveOutbox(next: DispatchRecord[]): void {
  // Bound retention: acked records are history, dead records are the visible
  // dead-letter queue; pending records are never pruned.
  const pending = next.filter((r) => r.status === "pending");
  const acked = next.filter((r) => r.status === "acked").slice(0, DISPATCH_ACKED_KEEP);
  const dead = next.filter((r) => r.status === "dead").slice(0, DISPATCH_DEAD_KEEP);
  storage.set(StoreKeys.timeDispatchOutbox, [...pending, ...acked, ...dead]);
}

export function dispatchOutbox(): DispatchRecord[] {
  return loadOutbox();
}

export function subscribeDispatchOutbox(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.timeDispatchOutbox, fn);
}

function patchDispatch(id: string, patch: Partial<DispatchRecord>): void {
  saveOutbox(loadOutbox().map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

/** Deliver one record to its registered consumer; ack/attempt/dead-letter. */
function attemptDispatch(dispatch: DispatchRecord): void {
  const consumer = dispatchConsumers.get(dispatch.targetCore);
  if (!consumer) return; // stays pending; retried when the consumer registers
  try {
    consumer(dispatch);
    patchDispatch(dispatch.id, { status: "acked", ackedAt: Date.now() });
  } catch (err) {
    const attempts = dispatch.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (attempts >= DISPATCH_MAX_ATTEMPTS) {
      patchDispatch(dispatch.id, {
        attempts,
        lastAttemptAt: Date.now(),
        status: "dead",
        error: message,
      });
      record({
        type: "system.event",
        summary: `Time Core: dispatch to ${dispatch.targetCore} dead-lettered after ${attempts} attempts — “${dispatch.label}”`,
        detail: message,
      });
      deliver({
        title: `A scheduled action for ${dispatch.targetCore} kept failing`,
        detail: `“${dispatch.label}” was retried ${attempts} times and set aside. (${message})`,
        source: "Time",
        priority: "high",
      });
    } else {
      patchDispatch(dispatch.id, { attempts, lastAttemptAt: Date.now(), error: message });
    }
  }
}

/**
 * Register the consumer for a target Core's durable dispatches. Exactly one
 * consumer per Core (the Core itself). Any dispatches that went pending while
 * no consumer was registered — a cold boot where the entry fired before the
 * Core wired up, or a previous session's failure — are delivered immediately.
 */
export function onCoreDispatch(targetCore: string, consumer: DispatchConsumer): () => void {
  dispatchConsumers.set(targetCore, consumer);
  for (const record of loadOutbox()) {
    if (record.targetCore === targetCore && record.status === "pending") {
      attemptDispatch(record);
    }
  }
  return () => {
    if (dispatchConsumers.get(targetCore) === consumer) dispatchConsumers.delete(targetCore);
  };
}

/** Retry pass, run inside the elected tick: pending records whose backoff
    elapsed are re-attempted (exponential per attempt count). */
function retryPendingDispatches(now: number): void {
  for (const record of loadOutbox()) {
    if (record.status !== "pending") continue;
    if (record.attempts === 0 && record.lastAttemptAt === undefined) {
      // Never attempted (consumer was missing at fire time) — try again now.
      attemptDispatch(record);
      continue;
    }
    const backoff = DISPATCH_RETRY_BASE_MS * Math.max(1, record.attempts);
    if (now - (record.lastAttemptAt ?? record.firedAt) >= backoff) attemptDispatch(record);
  }
}

/* -------------------------------- scheduler -------------------------------- */

type FireListener = (entry: TimeEntry) => void;
const fireListeners = new Set<FireListener>();

/** Subscribe to firings (Monitor, Dashboard, apps). Returns unsubscribe. */
export function onTimeFire(fn: FireListener): () => void {
  fireListeners.add(fn);
  return () => fireListeners.delete(fn);
}

const KIND_TITLES: Record<TimeEntryKind, string> = {
  alarm: "Alarm",
  timer: "Timer done",
  event: "Event starting",
  reminder: "Reminder",
  trigger: "Scheduled trigger",
};

function fire(entry: TimeEntry, missed: boolean): void {
  if (missed) {
    deliver({
      title: `Missed while away — ${KIND_TITLES[entry.kind].toLowerCase()}: ${entry.label}`,
      detail: `Was due ${formatDateTime(entry.at)}`,
      source: "Time",
      priority: "low",
      actions: [{ label: "Snooze 10 min", kind: "snooze-entry", entryId: entry.id }],
    });
    record({
      type: "time.entry.missed",
      summary: `Time Core: missed ${entry.kind} — “${entry.label}” (due ${formatDateTime(entry.at)})`,
    });
  } else {
    deliver({
      title: `${KIND_TITLES[entry.kind]}: ${entry.label}`,
      detail: formatDateTime(entry.at),
      source: "Time",
      // An alarm is time-critical and must break through quiet hours — as
      // "high" it was silently held until the quiet window ended.
      priority: entry.kind === "alarm" ? "critical" : "normal",
      actions: [{ label: "Snooze 10 min", kind: "snooze-entry", entryId: entry.id }],
    });
    record({
      type: "time.entry.fired",
      summary: `Time Core fired: ${entry.kind} — “${entry.label}”`,
    });
  }
  emit("time.entry.fired", entry);
  // Durable delivery for targetCore triggers: the dispatch record is persisted
  // BEFORE any consumer runs, so a missing or throwing consumer can no longer
  // silently lose the work — it stays pending and retries (see the outbox).
  if (entry.targetCore) {
    const dispatch: DispatchRecord = {
      id: `disp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      entryId: entry.id,
      targetCore: entry.targetCore,
      label: entry.label,
      payload: entry.payload,
      firedAt: Date.now(),
      attempts: 0,
      status: "pending",
    };
    saveOutbox([dispatch, ...loadOutbox()]);
    attemptDispatch(dispatch);
  }
  // A throwing listener must not abort the tick — the entry would never be
  // marked fired and the alarm would re-fire every pass.
  fireListeners.forEach((fn) => {
    try {
      fn(entry);
    } catch (err) {
      console.warn("[locus:time] fire listener failed", err);
    }
  });
}

/** Fired one-shot entries kept as history before the oldest are pruned. */
const MAX_FIRED_HISTORY = 200;

function pruneFired(list: TimeEntry[]): TimeEntry[] {
  const fired = list.filter((e) => e.firedAt);
  if (fired.length <= MAX_FIRED_HISTORY) return list;
  const keep = new Set(
    fired
      .sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0))
      .slice(0, MAX_FIRED_HISTORY)
      .map((e) => e.id),
  );
  return list.filter((e) => !e.firedAt || keep.has(e.id));
}

function tick(): void {
  const now = Date.now();
  const due: { entry: TimeEntry; missed: boolean }[] = [];
  const next = load().map((e) => {
    if (e.firedAt || e.at > now) return e;
    const missed = now - e.at > MISSED_GRACE_MS;
    due.push({ entry: e, missed });
    if (e.recurrence !== "none") {
      return {
        ...e,
        at: nextOccurrence(e.at, e.recurrence, now, e.anchorAt ?? e.at),
        lastFiredAt: now,
        // The missed outcome is retained even though the grid advances — a
        // recurring occurrence that fired as "missed while away" stays on the
        // record instead of dissolving into the next occurrence.
        lastMissedAt: missed ? now : e.lastMissedAt,
      };
    }
    return { ...e, firedAt: now, missed: missed || undefined };
  });
  // Persist BEFORE delivering: a throwing deliver/listener can no longer
  // leave an entry unfired (a 5s re-fire storm), and a fire listener that
  // writes time entries is no longer clobbered by this tick's save.
  if (due.length) save(pruneFired(next));
  for (const { entry, missed } of due) {
    try {
      fire(entry, missed);
    } catch (err) {
      console.warn("[locus:time] fire failed for", entry.id, err);
    }
  }
  retryPendingDispatches(now);
  runScheduledJobs(now);
}

/* --------------------- shared periodic jobs (one scheduler) ------------------ */

interface ScheduledCoreJob {
  name: string;
  everyMs: number;
  fn: () => void;
  lastRun: number;
}

const jobs = new Map<string, ScheduledCoreJob>();

/**
 * Register a periodic job with the OS's one scheduler — this is how other
 * Cores (Monitor's evaluator, Notification's quiet-hours release) run on a
 * cadence without private setIntervals or their own multi-tab elections.
 * Jobs run inside the elected Time tick, so exactly one tab evaluates.
 */
export function registerScheduledJob(name: string, everyMs: number, fn: () => void): () => void {
  if (jobs.has(name)) {
    console.warn(`[locus:time] scheduled job "${name}" is being replaced — duplicate registration`);
  }
  jobs.set(name, { name, everyMs, fn, lastRun: 0 });
  // Only delete if we still own this name — a later re-registration replaced us,
  // and an old disposer must not remove the replacement.
  return () => {
    if (jobs.get(name)?.fn === fn) jobs.delete(name);
  };
}

function runScheduledJobs(now: number): void {
  for (const job of jobs.values()) {
    if (now - job.lastRun < job.everyMs) continue;
    job.lastRun = now;
    try {
      job.fn();
    } catch (err) {
      console.warn(`[locus:time] scheduled job "${job.name}" failed`, err);
    }
  }
}

/** Next local 9:00 tomorrow — the default slot for an assistant reminder. */
function tomorrowAt9(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/**
 * Materialize an approved assistant reminder into a real TimeEntry (tomorrow at
 * 9:00). The Broker's `time.reminder` executor calls this on approval, so an
 * approved reminder is actually scheduled — not turned into a stray task the
 * scheduler never sees. The label is already redaction-shaped by the Broker.
 */
export function scheduleAssistantReminder(label: string): TimeEntry {
  return createReminder(label, tomorrowAt9(), "assistant");
}

let started = false;

/** Boot the scheduler. Safe to call once at startup. Multi-tab safe: the tick
    is elected (F4), so entries fire exactly once across open tabs. */
export function initTimeCore(): void {
  if (started) return;
  started = true;
  watchCache();
  startElectedInterval("time-core", 5000, tick);
}
