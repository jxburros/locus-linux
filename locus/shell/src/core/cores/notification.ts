/*
 * Notification Core — delivery, not decision (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: alerts, reminders, status messages, attention requests, history,
 * priority, snooze, grouping, and delivery surfaces. Other Cores decide what
 * matters and when; this Core delivers the message consistently — Time,
 * Monitor, the AI Broker, Tasks, Files, and Dev all send through here instead
 * of inventing their own alert behavior.
 *
 * The store itself lives in core/notifications (private pushNotification).
 * deliver() is the ONE public send path, and it applies the notification
 * policy: quiet hours (critical alerts always break through; everything else
 * lands in history, held until quiet hours end) and per-source mute (history,
 * no attention). A scheduled job releases held items the moment their hold
 * expires, so quiet-hours mail becomes visibly unread without a manual poke.
 */

import { storage, StoreKeys } from "../storage";
import { emit } from "../events";
import {
  pushNotification,
  getNotifications,
  reconcilePolicyHolds,
  touch,
  type Notification,
  type NotificationAction,
  type NotificationPriority,
} from "../notifications";
import { registerScheduledJob } from "./time";

export {
  getNotifications,
  unreadCount,
  isHeld,
  markAllRead,
  dismiss,
  snoozeNotification,
  clearNotifications,
  subscribe as subscribeNotifications,
  type Notification,
  type NotificationAction,
  type NotificationPriority,
} from "../notifications";

/* -------------------------------- quiet hours ------------------------------ */

export interface NotificationPolicy {
  quietEnabled: boolean;
  /** Local hour (0–23) quiet time starts. */
  quietStartHour: number;
  /** Local hour (0–23) quiet time ends. May wrap past midnight. */
  quietEndHour: number;
  /** Sources whose messages land in history already-read (no attention). */
  mutedSources: string[];
}

const DEFAULT_POLICY: NotificationPolicy = {
  quietEnabled: false,
  quietStartHour: 22,
  quietEndHour: 7,
  mutedSources: [],
};

export function getNotificationPolicy(): NotificationPolicy {
  const stored = storage.get<Partial<NotificationPolicy>>(StoreKeys.notificationPolicy, {});
  // Coerce a malformed persisted policy so deliver() cannot throw on it — a
  // non-array mutedSources would make `.includes` blow up the delivery path.
  return {
    ...DEFAULT_POLICY,
    ...stored,
    mutedSources: Array.isArray(stored.mutedSources)
      ? stored.mutedSources.filter((s): s is string => typeof s === "string")
      : DEFAULT_POLICY.mutedSources,
    quietStartHour:
      typeof stored.quietStartHour === "number" ? stored.quietStartHour : DEFAULT_POLICY.quietStartHour,
    quietEndHour:
      typeof stored.quietEndHour === "number" ? stored.quietEndHour : DEFAULT_POLICY.quietEndHour,
  };
}

export function setNotificationPolicy(patch: Partial<NotificationPolicy>): void {
  storage.set(StoreKeys.notificationPolicy, { ...getNotificationPolicy(), ...patch });
  // Reconcile POLICY holds against the new policy (Wave 3): disabling quiet
  // hours (or moving the window so "now" is outside it) releases held items
  // immediately; a moved window re-pins live holds to its new end. User
  // snoozes are a separate field and are never touched by a policy change.
  reconcilePolicyHolds(inQuietHours() ? quietHoursEnd() : null);
}

export function setSourceMuted(source: string, muted: boolean): void {
  const policy = getNotificationPolicy();
  const set = new Set(policy.mutedSources);
  if (muted) set.add(source);
  else set.delete(source);
  setNotificationPolicy({ mutedSources: [...set] });
}

export function subscribeNotificationPolicy(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.notificationPolicy, fn);
}

/** Is the given moment inside quiet hours? Handles ranges that wrap midnight. */
export function inQuietHours(at: number = Date.now()): boolean {
  const policy = getNotificationPolicy();
  if (!policy.quietEnabled) return false;
  const hour = new Date(at).getHours();
  const { quietStartHour: start, quietEndHour: end } = policy;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** When the current quiet window ends (absolute ms), for held deliveries. */
function quietHoursEnd(at: number = Date.now()): number {
  const policy = getNotificationPolicy();
  const d = new Date(at);
  d.setMinutes(0, 0, 0);
  d.setHours(policy.quietEndHour);
  if (d.getTime() <= at) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/* --------------------------------- delivery -------------------------------- */

export interface DeliverInput {
  title: string;
  detail?: string;
  source: string;
  priority?: NotificationPriority;
  actions?: NotificationAction[];
}

/*
 * Redaction choke point (F5). Secrets Core registers redactText here at boot
 * (injected — Secrets itself delivers notifications, so a direct import would
 * be a cycle). Notification text often interpolates object titles, and a key
 * pasted into a title must not surface in the shade.
 */
type Redactor = (text: string) => string;
let redactor: Redactor = (text) => text;

/** Called once by Secrets Core so every delivery passes through redaction. */
export function setNotificationRedactor(fn: Redactor): void {
  redactor = fn;
}

/**
 * The delivery path every Core and app uses. Applies notification policy:
 * during quiet hours, non-critical messages land in history but are held out
 * of the unread count until quiet hours end; muted sources land already-read.
 * Critical always breaks through both.
 */
export function deliver(input: DeliverInput): void {
  const critical = input.priority === "critical";
  const muted = !critical && getNotificationPolicy().mutedSources.includes(input.source);
  const holdBack = !critical && !muted && inQuietHours();
  const n = pushNotification({
    ...input,
    title: redactor(input.title),
    detail: input.detail === undefined ? undefined : redactor(input.detail),
    // Source and action labels are interpolated text too — a pasted key in a
    // source name or button label must redact like the title and detail.
    source: redactor(input.source),
    actions: input.actions?.map((a) => ({ ...a, label: redactor(a.label) })),
    read: muted || undefined,
    // A quiet-hours hold is POLICY state (heldUntil), not a user snooze.
    heldUntil: holdBack ? quietHoursEnd() : undefined,
  });
  emit("notification.delivered", n);
}

/* ----------------------------- held-item release ---------------------------- */

let started = false;

/**
 * Boot the release job: when a held notification's snooze/quiet window
 * passes, nudge subscribers so it becomes visibly unread immediately —
 * "held, not dropped" includes actually showing up when the hold ends.
 */
export function initNotificationCore(): void {
  if (started) return;
  started = true;
  let lastCheck = Date.now();
  registerScheduledJob("notification-release", 30_000, () => {
    const now = Date.now();
    // Exact release detection: did any hold OR snooze expire since the last
    // pass? (A count delta misses one hold expiring while another begins.)
    const released = getNotifications().some((n) => {
      const until = Math.max(n.snoozedUntil ?? 0, n.heldUntil ?? 0);
      return !n.read && until > lastCheck && until <= now;
    });
    if (released) touch();
    lastCheck = now;
  });
}

/* --------------------------------- grouping -------------------------------- */

export interface NotificationGroup {
  source: string;
  items: Notification[];
  latestAt: number;
}

/** Group history by source for the delivery surfaces, newest group first. */
export function groupBySource(): NotificationGroup[] {
  const groups = new Map<string, Notification[]>();
  for (const n of getNotifications()) {
    if (!groups.has(n.source)) groups.set(n.source, []);
    groups.get(n.source)!.push(n);
  }
  return [...groups.entries()]
    .map(([source, items]) => ({
      source,
      items,
      latestAt: Math.max(...items.map((i) => i.at)),
    }))
    .sort((a, b) => b.latestAt - a.latestAt);
}
