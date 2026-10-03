/*
 * People Core — people as a system-level concept (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: contacts, identities, groups, relationships, birthdays, cadence,
 * interaction history, and people-linked notes or tasks. Apps refer to the
 * same contact identities instead of copying names into isolated fields.
 *
 * The interaction model takes its shape from Pal-Plant (the relationship-
 * cadence app): interactions are logged per channel, each contact carries its
 * own follow-up cadence, and cadence health is a computable value Monitor
 * Core can watch — with "never contacted" as an explicit state, not fake
 * perfect health. Notes about a person belong to Cardspoke Core (linked by
 * id); reminders belong to Time Core, and initPeopleCore materializes yearly
 * birthday reminders there, making the People ⇄ Time dependency real.
 *
 * AI uses this Core to suggest follow-ups, draft reminders, link notes to
 * people, and reason about relationship context — through contactForAI, which
 * never exposes contact details (phone/email/social) without approval.
 */

import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { emit, on } from "../events";
import { getObject, isObjectTrashed } from "../objects";
import {
  createTimeEntry,
  cancelTimeEntriesByDedupeKey,
  onCoreDispatch,
  registerScheduledJob,
} from "./time";
import type { SystemObject } from "@/types";

/** How an interaction happened — the Pal-Plant channel vocabulary. */
export type InteractionChannel = "in-person" | "call" | "video" | "text" | "other";

export const INTERACTION_CHANNELS: InteractionChannel[] = [
  "in-person",
  "call",
  "video",
  "text",
  "other",
];

export interface InteractionEntry {
  id: string;
  at: number;
  channel: InteractionChannel;
  note?: string;
}

export interface Contact {
  id: string;
  name: string;
  nickname?: string;
  phone?: string;
  email?: string;
  social?: string;
  category: string; //   Friend / Family / Work / …
  groups: string[];
  /** yyyy-mm-dd, portable like task due dates. */
  birthday?: string;
  lastContactAt?: number;
  /** Days between touches this relationship wants (per-contact cadence). */
  followUpDays?: number;
  /** Interaction history, newest first (capped). */
  interactions?: InteractionEntry[];
  /** Cardspoke card id carrying notes about this person. */
  notesCardId?: string;
  /** Archived contacts are kept but out of active lists (soft delete). */
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

const INTERACTION_LIMIT = 50;
let seq = 0;
function makeId(prefix = "ct"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

let cache: Contact[] | null = null;
// Derived views are memoized so they hold a stable reference between writes —
// useSyncExternalStore snapshots must not be fresh arrays per call.
let activeCache: Contact[] | null = null;
let archivedCache: Contact[] | null = null;

function load(): Contact[] {
  if (cache === null) cache = storage.get<Contact[]>(StoreKeys.peopleContacts, []);
  return cache;
}

function save(next: Contact[]): void {
  cache = next;
  activeCache = null;
  archivedCache = null;
  storage.set(StoreKeys.peopleContacts, next);
}

/** Active contacts (archived ones excluded). Stable reference between writes. */
export function listContacts(): Contact[] {
  if (activeCache === null) activeCache = load().filter((c) => !c.archivedAt);
  return activeCache;
}

export function archivedContacts(): Contact[] {
  if (archivedCache === null) archivedCache = load().filter((c) => !!c.archivedAt);
  return archivedCache;
}

export function getContact(id: string): Contact | undefined {
  return load().find((c) => c.id === id);
}

export function subscribeContacts(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.peopleContacts, () => {
    cache = storage.get<Contact[]>(StoreKeys.peopleContacts, []);
    activeCache = null;
    archivedCache = null;
    fn();
  });
}

// Keep the module cache fresh even when no component in this tab subscribes.
// Background consumers (initPeopleCore's birthday scheduling, dueFollowUps used
// by Monitor) must see cross-tab contact writes, or a tab with no People UI
// mounted reads and reschedules from stale data. Registered once at boot.
let cacheWatcherStarted = false;
function watchCache(): void {
  if (cacheWatcherStarted) return;
  cacheWatcherStarted = true;
  storage.subscribe(StoreKeys.peopleContacts, () => {
    cache = storage.get<Contact[]>(StoreKeys.peopleContacts, []);
    activeCache = null;
    archivedCache = null;
  });
}

export function addContact(input: { name: string; category?: string }): Contact {
  const now = Date.now();
  const contact: Contact = {
    id: makeId(),
    name: input.name.trim(),
    category: input.category ?? "Friend",
    groups: [],
    createdAt: now,
    updatedAt: now,
  };
  save([contact, ...load()]);
  record({
    type: "contact.created",
    summary: `People Core: contact added — ${contact.name}`,
    skipEmit: true, // the bus event below carries the Contact itself
  });
  emit("contact.created", contact);
  return contact;
}

/** Contact fields whose edits are sensitive enough to audit individually. */
const SENSITIVE_FIELDS: (keyof Contact)[] = ["phone", "email", "social", "birthday"];

export function updateContact(id: string, patch: Partial<Omit<Contact, "id" | "createdAt">>): void {
  const before = getContact(id);
  if (!before) return;
  save(load().map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)));
  const after = getContact(id);
  emit("contact.updated", after);
  const touched = SENSITIVE_FIELDS.filter(
    (f) => f in patch && patch[f as keyof typeof patch] !== before[f],
  );
  if (touched.length > 0) {
    // Contact details are sensitive: the change is on the record, the values
    // themselves are not (this is an audit line, not a data mirror).
    record({
      type: "contact.updated",
      summary: `People Core: ${before.name} — ${touched.join(", ")} changed`,
      skipEmit: true, // emit("contact.updated", after) above carries the Contact
    });
  }
  // A changed birthday must reschedule the reminder — the dedupe key would
  // otherwise pin the old date's unfired entry forever.
  if ("birthday" in patch && patch.birthday !== before.birthday) {
    cancelTimeEntriesByDedupeKey(`birthday-${id}`);
    const updated = getContact(id);
    if (updated?.birthday && upcomingBirthdays(30).some((c) => c.id === id)) {
      scheduleBirthdayReminder(id);
    }
  }
}

/** Archive: the contact leaves active lists but nothing is destroyed. */
export function archiveContact(id: string): void {
  const c = getContact(id);
  if (!c || c.archivedAt) return;
  updateContact(id, { archivedAt: Date.now() });
  // Archived contacts do not remind — restore recreates the entry.
  cancelTimeEntriesByDedupeKey(`birthday-${id}`);
  record({ type: "contact.removed", summary: `People Core: contact archived — ${c.name}` });
}

export function restoreContact(id: string): void {
  const c = getContact(id);
  if (!c?.archivedAt) return;
  save(load().map((x) => (x.id === id ? { ...x, archivedAt: undefined, updatedAt: Date.now() } : x)));
  if (c.birthday && upcomingBirthdays(30).some((x) => x.id === id)) {
    scheduleBirthdayReminder(id);
  }
  record({ type: "contact.created", summary: `People Core: contact restored — ${c.name}` });
}

/**
 * Permanent removal. The linked notes card is deliberately kept — it is the
 * user's writing — but the orphaning is on the record so it can be found.
 */
export function removeContact(id: string): void {
  const c = load().find((x) => x.id === id);
  save(load().filter((x) => x.id !== id));
  // Without this, the deleted contact's birthday fires every year forever.
  cancelTimeEntriesByDedupeKey(`birthday-${id}`);
  if (c) {
    record({
      type: "contact.removed",
      summary: `People Core: contact removed — ${c.name}`,
      detail: c.notesCardId
        ? `The notes card for ${c.name} was kept (find it in Cards).`
        : undefined,
      skipEmit: true, // the bus event below carries the Contact itself
    });
    emit("contact.removed", c);
  }
}

/* ----------------------- person ↔ object relationships ----------------------- */

/*
 * The stable relationship model (Wave 3): typed, indexed links between a
 * contact and any SystemObject, with reverse lookup and referential repair.
 * The single unchecked `notesCardId` pointer becomes one row in this table
 * (migrated at init); apps and the AI reason over links, not ad-hoc fields.
 */

export type PersonLinkKind = "note" | "task" | "document" | "project" | "other";

export interface PersonLink {
  id: string;
  contactId: string;
  objectId: string;
  kind: PersonLinkKind;
  createdAt: number;
}

let linkCache: PersonLink[] | null = null;

function loadLinks(): PersonLink[] {
  if (linkCache === null)
    linkCache = storage.get<PersonLink[]>(StoreKeys.peopleLinks, [], Array.isArray);
  return linkCache;
}

function saveLinks(next: PersonLink[]): void {
  linkCache = next;
  storage.set(StoreKeys.peopleLinks, next);
}

export function subscribePersonLinks(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.peopleLinks, () => {
    linkCache = storage.get<PersonLink[]>(StoreKeys.peopleLinks, [], Array.isArray);
    fn();
  });
}

const KIND_FOR_TYPE: Partial<Record<SystemObject["type"], PersonLinkKind>> = {
  card: "note",
  task: "task",
  document: "document",
  project: "project",
};

/** Link a contact to an object (idempotent per pair). Both ends must exist. */
export function linkPersonToObject(
  contactId: string,
  objectId: string,
  kind?: PersonLinkKind,
): PersonLink | null {
  const contact = getContact(contactId);
  const object = getObject(objectId);
  if (!contact || !object || isObjectTrashed(object)) return null;
  const existing = loadLinks().find(
    (l) => l.contactId === contactId && l.objectId === objectId,
  );
  if (existing) return existing;
  const link: PersonLink = {
    id: makeId("pl"),
    contactId,
    objectId,
    kind: kind ?? KIND_FOR_TYPE[object.type] ?? "other",
    createdAt: Date.now(),
  };
  saveLinks([link, ...loadLinks()]);
  record({
    type: "system.event",
    summary: `People Core: linked ${contact.name} ↔ “${object.title || "Untitled"}” (${link.kind})`,
  });
  return link;
}

export function unlinkPersonFromObject(contactId: string, objectId: string): boolean {
  const before = loadLinks();
  const next = before.filter((l) => !(l.contactId === contactId && l.objectId === objectId));
  if (next.length === before.length) return false;
  saveLinks(next);
  return true;
}

/** All of a contact's links (dead ends already repaired away). */
export function linksForContact(contactId: string): PersonLink[] {
  return loadLinks().filter((l) => l.contactId === contactId);
}

/** Reverse lookup: which contacts is this object linked to? */
export function contactsForObject(objectId: string): Contact[] {
  const ids = new Set(loadLinks().filter((l) => l.objectId === objectId).map((l) => l.contactId));
  return listContacts().filter((c) => ids.has(c.id));
}

/**
 * Referential repair: drop links whose contact or object no longer exists
 * (or whose object sits in a trash). Runs at init and whenever an object or
 * contact is removed, so the table cannot accumulate dead ends the way the
 * old unchecked notesCardId pointer could.
 */
export function repairPersonLinks(): number {
  const before = loadLinks();
  const next = before.filter((l) => {
    if (!getContact(l.contactId)) return false;
    const o = getObject(l.objectId);
    return !!o && !isObjectTrashed(o);
  });
  if (next.length === before.length) return 0;
  saveLinks(next);
  return before.length - next.length;
}

/** One-time migration: fold legacy notesCardId pointers into the link table. */
function migrateNotesCardLinks(): void {
  for (const c of load()) {
    if (c.notesCardId) linkPersonToObject(c.id, c.notesCardId, "note");
  }
}

/* ---------------------------- interaction history --------------------------- */

/** Log an interaction with its channel — the interaction history entry. */
export function logInteraction(
  id: string,
  channel: InteractionChannel = "other",
  note?: string,
): void {
  const c = load().find((x) => x.id === id);
  if (!c) return;
  const entry: InteractionEntry = { id: makeId("ix"), at: Date.now(), channel, note };
  updateContact(id, {
    lastContactAt: entry.at,
    interactions: [entry, ...(c.interactions ?? [])].slice(0, INTERACTION_LIMIT),
  });
  record({
    type: "contact.interaction.logged",
    summary: `People Core: contacted ${c.name} (${channel})`,
    skipEmit: true, // the bus event below carries the contact + entry
  });
  // Emit the post-update contact, not the stale pre-update snapshot.
  emit("contact.interaction.logged", { contact: getContact(id) ?? c, entry });
}

/** Back-compat: log an untyped interaction. */
export function markContacted(id: string): void {
  logInteraction(id, "other");
}

/* --------------------------------- cadence ---------------------------------- */

const DAY = 86_400_000;
export const DEFAULT_CADENCE_DAYS = 30;

/**
 * Cadence health for a contact, Pal-Plant style: 1 right after an
 * interaction, falling to 0 as the follow-up window expires (then negative
 * as it grows overdue, clamped at -1). Returns null for a contact who has
 * never been contacted — an explicit state, not 100% health.
 */
export function cadenceHealth(c: Contact, now = Date.now()): number | null {
  if (!c.lastContactAt) return null;
  const windowDays = c.followUpDays ?? DEFAULT_CADENCE_DAYS;
  const elapsed = (now - c.lastContactAt) / (windowDays * DAY);
  return Math.max(-1, 1 - elapsed);
}

/** Contacts past their follow-up window — Monitor Core's cadence source.
    Uses each contact's own cadence; `days` is the fallback for contacts
    without one. Never-contacted contacts count from their creation. */
export function dueFollowUps(days = DEFAULT_CADENCE_DAYS): Contact[] {
  const now = Date.now();
  return listContacts().filter((c) => {
    const windowDays = c.followUpDays ?? days;
    return (c.lastContactAt ?? c.createdAt) < now - windowDays * DAY;
  });
}

/* -------------------------------- birthdays --------------------------------- */

/**
 * The concrete date a birthday falls on in a given year, with the explicit
 * clamp rule: Feb 29 birthdays fall on Feb 28 in non-leap years (never
 * rolling into March, which is what naive Date construction does).
 */
export function birthdayOccurrence(birthday: string, year: number): Date | null {
  const [, m, d] = birthday.split("-").map(Number);
  // Reject out-of-range month/day rather than letting Date normalization turn
  // "2026-99-99" into a valid-but-wrong date months away. Feb-29 still clamps
  // to Feb-28 below (d ≤ 31 passes, then Math.min against the month length).
  if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const days = new Date(year, m, 0).getDate();
  return new Date(year, m - 1, Math.min(d, days));
}

/** The next occurrence of a birthday at local 9:00, from `from`. A birthday
    later today still counts as today (it has not passed until midnight). */
export function nextBirthdayAt(birthday: string, from: number = Date.now()): number | null {
  const fromDate = new Date(from);
  for (const year of [fromDate.getFullYear(), fromDate.getFullYear() + 1]) {
    const day = birthdayOccurrence(birthday, year);
    if (!day) return null;
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);
    if (endOfDay.getTime() >= from) {
      const at = new Date(day);
      at.setHours(9, 0, 0, 0);
      // If 9:00 already passed but the day hasn't, remind shortly instead of
      // silently scheduling next year.
      return at.getTime() >= from ? at.getTime() : from + 60_000;
    }
  }
  return null;
}

/** Contacts whose birthday (mm-dd) falls within the next `days` days. */
export function upcomingBirthdays(days = 14): Contact[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + days * DAY;
  return listContacts().filter((c) => {
    if (!c.birthday) return false;
    for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
      const t = birthdayOccurrence(c.birthday, year)?.getTime();
      if (t !== undefined && t >= start && t < end) return true;
    }
    return false;
  });
}

/**
 * Create (or return) the yearly birthday reminder for a contact — a real
 * Time Core entry with yearly recurrence, deduplicated per contact.
 */
export function scheduleBirthdayReminder(contactId: string) {
  const c = getContact(contactId);
  if (!c?.birthday) return null;
  const at = nextBirthdayAt(c.birthday);
  if (!at) return null;
  // The yearly grid anchors at 9:00 on the birthday itself, even when the
  // first fire is "shortly" because 9:00 already passed today — otherwise
  // every future year would remind at that arbitrary afternoon minute.
  const anchor = new Date(at);
  anchor.setHours(9, 0, 0, 0);
  return createTimeEntry({
    kind: "reminder",
    label: `${c.name}'s birthday`,
    at,
    anchorAt: anchor.getTime(),
    recurrence: "yearly",
    source: "people",
    dedupeKey: `birthday-${c.id}`,
    // Durable trigger payload: routes the firing back to People Core (below)
    // so it can react with contact-specific context, not just a generic
    // Time Core notification.
    targetCore: "people",
    payload: { contactId: c.id },
  });
}

/**
 * The durable-trigger consumer side of the birthday reminder, on Time Core's
 * dispatch outbox: every `targetCore: "people"` firing persists a dispatch
 * record BEFORE this consumer runs, the consumer acks it by returning
 * normally, and a firing that lands while People is not yet registered (cold
 * boot ordering) is delivered the moment registration happens instead of
 * being lost. A missing contact is an acked no-op, not an error — the contact
 * was deleted after the reminder was scheduled.
 */
let triggersRegistered = false;
function registerTriggerConsumer(): void {
  if (triggersRegistered) return;
  triggersRegistered = true;
  onCoreDispatch("people", (dispatch) => {
    const contactId = dispatch.payload?.contactId;
    if (typeof contactId !== "string") return;
    const c = getContact(contactId);
    if (!c) return;
    record({
      type: "system.event",
      summary: `People Core: birthday reminder fired for ${c.name}`,
    });
  });
}

/** Materialize reminders for every birthday inside the horizon (idempotent). */
function reconcileBirthdays(horizonDays: number): void {
  for (const c of upcomingBirthdays(horizonDays)) {
    scheduleBirthdayReminder(c.id);
  }
}

/**
 * Boot hook: materialize birthday reminders for birthdays inside the horizon
 * window, and keep reconciling DAILY on the shared scheduler — a long-running
 * PWA session crosses into the horizon without ever re-booting, so a boot-only
 * pass would silently stop scheduling (the audit's horizon-rollover gap).
 * Idempotent throughout (dedupeKey per contact). Also wires the durable
 * dispatch consumer, the notesCardId migration, and referential link repair.
 */
export function initPeopleCore(horizonDays = 30): void {
  watchCache();
  registerTriggerConsumer();
  migrateNotesCardLinks();
  repairPersonLinks();
  // Keep the link table honest as objects/contacts disappear.
  on("object.deleted", () => repairPersonLinks());
  on("object.trashed", () => repairPersonLinks());
  on("contact.removed", () => repairPersonLinks());
  reconcileBirthdays(horizonDays);
  registerScheduledJob("people-birthday-reconcile", 12 * 60 * 60_000, () =>
    reconcileBirthdays(horizonDays),
  );
}

/* ----------------------------------- AI ------------------------------------- */

/**
 * What the AI may read about a person without an approval: identity,
 * relationship context, and cadence — never phone/email/social. Exposing
 * contact details requires an approved proposal through the broker.
 */
export function contactForAI(id: string): string | null {
  const c = getContact(id);
  if (!c) return null;
  const health = cadenceHealth(c);
  // Birthday is a SENSITIVE_FIELD with no readable capability in the People
  // manifest, so it is deliberately NOT in the default AI view — identity,
  // relationship context, and cadence only. Exposing the birthday (like
  // phone/email/social) requires an approved read grant, not this line.
  const parts = [
    `${c.name}${c.nickname ? ` (“${c.nickname}”)` : ""} — ${c.category}`,
    c.groups.length ? `groups: ${c.groups.join(", ")}` : "",
    c.lastContactAt
      ? `last contact ${Math.round((Date.now() - c.lastContactAt) / DAY)}d ago`
      : "never contacted",
    health !== null ? `cadence health ${(health * 100).toFixed(0)}%` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
