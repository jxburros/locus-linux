/*
 * Notification Center store.
 * ---------------------------------------------------------------------------
 * A small persisted inbox for system and app notifications. Distinct from the
 * audit log: the audit log is the complete record; notifications are the few
 * things worth surfacing. This module is the raw store; the delivery policy
 * (quiet hours, priority, per-source mute) lives in cores/notification —
 * senders call deliver() there, never notify() here directly.
 */

import { storage, StoreKeys } from "./storage";
import { emit } from "./events";
import type { AppId } from "@/types";

/** Delivery priority (Notification Core). Other Cores decide *what* matters;
    this layer only routes and displays it. */
export type NotificationPriority = "low" | "normal" | "high" | "critical";

/**
 * A declarative action button on a notification. Kept as data (not a
 * callback) so it survives persistence; the rendering surface services it:
 * "open-app" focuses an app, "snooze-entry" reschedules a Time Core entry.
 */
export interface NotificationAction {
  label: string;
  kind: "open-app" | "snooze-entry";
  appId?: AppId;
  entryId?: string;
  /** Minutes to snooze, for snooze-entry (default 10). */
  minutes?: number;
}

export interface Notification {
  id: string;
  title: string;
  detail?: string;
  source: string;
  at: number;
  read: boolean;
  priority?: NotificationPriority;
  /** USER snooze: the user pushed this item back. Distinct from heldUntil. */
  snoozedUntil?: number;
  /**
   * POLICY hold (quiet hours): delivery landed during a quiet window and is
   * held out of the unread count until the window ends. Kept separate from
   * the user's snooze so a quiet-hours change can reconcile holds without
   * touching snoozes — and vice versa.
   */
  heldUntil?: number;
  actions?: NotificationAction[];
}

/** Cap for READ history — read items are the only thing the cap may evict. */
const LIMIT = 60;
/** Safety bound for pending attention (unread/held/critical). Far above any
    normal inbox; crossing it is recorded loudly instead of silently. */
const PENDING_LIMIT = 300;
let seq = 0;

let cache: Notification[] | null = null;

function load(): Notification[] {
  if (cache) return cache;
  cache = storage.get<Notification[]>(StoreKeys.notifications, []);
  return cache;
}

/** Re-read from storage, bypassing the cache — used by mutators so a write
    computed in this tab does not clobber a newer inbox another tab persisted
    (the cache can be stale until a storage event lands). */
function freshLoad(): Notification[] {
  cache = storage.get<Notification[]>(StoreKeys.notifications, []);
  return cache;
}

function save(next: Notification[]): void {
  cache = next;
  storage.set(StoreKeys.notifications, next);
}

/** Does this item still demand attention (must not be evicted by the cap)? */
function isPendingAttention(n: Notification): boolean {
  return !n.read || n.priority === "critical" || isHeld(n);
}

/**
 * Pending-vs-history split (Wave 3): the cap evicts READ history only —
 * held, unread, and critical items are never dropped to make room, so "held,
 * not dropped" is structural, not best-effort. Pending items have their own
 * generous safety bound; crossing it drops the oldest non-critical pending
 * item and says so on the record instead of doing it silently.
 */
function evict(list: Notification[]): Notification[] {
  const pending = list.filter(isPendingAttention);
  const history = list.filter((n) => !isPendingAttention(n));
  const keptHistory = history.length > LIMIT ? history.slice(0, LIMIT) : history;
  let keptPending = pending;
  if (pending.length > PENDING_LIMIT) {
    const critical = pending.filter((n) => n.priority === "critical");
    const rest = pending.filter((n) => n.priority !== "critical");
    const overflow = pending.length - PENDING_LIMIT;
    keptPending = [...critical, ...rest.slice(0, Math.max(0, rest.length - overflow))];
    console.warn(
      `[locus:notifications] pending overflow — dropped ${pending.length - keptPending.length} oldest non-critical pending item(s)`,
    );
  }
  if (keptPending.length === pending.length && keptHistory.length === history.length) return list;
  const keep = new Set([...keptPending, ...keptHistory].map((n) => n.id));
  return list.filter((n) => keep.has(n.id));
}

export function getNotifications(): Notification[] {
  return load();
}

/** Unread, hold/snooze-aware: held or snoozed items do not count until their time. */
export function unreadCount(now: number = Date.now()): number {
  return load().filter((n) => !n.read && !isHeld(n, now)).length;
}

/** Is this notification currently held out of the unread count — by the
    user's snooze OR a quiet-hours policy hold? */
export function isHeld(n: Notification, now: number = Date.now()): boolean {
  return (n.snoozedUntil ?? 0) > now || (n.heldUntil ?? 0) > now;
}

/**
 * Append to history. Internal to the notification layer: cores/notification's
 * deliver() is the public path (it applies quiet hours and mute policy).
 */
export function pushNotification(input: {
  title: string;
  detail?: string;
  source: string;
  priority?: NotificationPriority;
  /** POLICY hold: delivered into history but held out of the unread count
      until then — how Notification Core honors quiet hours without dropping
      anything. Distinct from a user snooze. */
  heldUntil?: number;
  /** Muted-source deliveries land already read (history, no attention). */
  read?: boolean;
  actions?: NotificationAction[];
}): Notification {
  seq += 1;
  const n: Notification = {
    id: `n-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: input.title,
    detail: input.detail,
    source: input.source,
    at: Date.now(),
    read: input.read ?? false,
    priority: input.priority ?? "normal",
    heldUntil: input.heldUntil,
    actions: input.actions,
  };
  save(evict([n, ...freshLoad()]));
  return n;
}

/**
 * Recompute policy holds (quiet-hours change). The caller supplies the new
 * hold horizon: null releases every policy hold (quiet hours disabled or the
 * window has ended), a timestamp re-pins live holds to the new window end.
 * USER snoozes are untouched either way — that is the point of the split.
 */
export function reconcilePolicyHolds(newHoldUntil: number | null): void {
  const now = Date.now();
  save(
    freshLoad().map((n) => {
      if (!n.heldUntil || n.heldUntil <= now) return n;
      return { ...n, heldUntil: newHoldUntil ?? undefined };
    }),
  );
}

/** Snooze: hide from the unread count until the given time. */
export function snoozeNotification(id: string, minutes: number): void {
  const until = Date.now() + minutes * 60_000;
  save(freshLoad().map((n) => (n.id === id ? { ...n, snoozedUntil: until } : n)));
  emit("notification.snoozed", { id, until });
}

export function markAllRead(): void {
  save(freshLoad().map((n) => (n.read ? n : { ...n, read: true })));
}

export function dismiss(id: string): void {
  save(freshLoad().filter((n) => n.id !== id));
}

export function clearNotifications(): void {
  save([]);
}

/** Nudge subscribers without changing content — used when a hold expires so
    held items become visibly unread the moment quiet hours end. Re-reads fresh
    first so this write cannot overwrite a newer inbox from another tab. */
export function touch(): void {
  save([...freshLoad()]);
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.notifications, () => {
    cache = null;
    fn();
  });
}
