/*
 * Cardspoke Core — shared structured user information (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: cards, notes, tasks, lightweight documents, links, backlinks, tags,
 * and conversions between information shapes. Modeled on the CardSpoke app's
 * core (its DOM-free kernel + typed cards + queries + conversions), whose
 * central part was built to be lifted and applied elsewhere:
 *
 *   - [[Title]] wiki-links in body text, resolved to objects, with backlinks
 *   - #inline-tags extracted from body text on every Core-path save
 *   - related-object discovery by shared tags
 *   - lossless shape conversions (the previous sub-record is snapshotted)
 *   - typed queries (due today, overdue, by type + tag, persisted saved filters)
 *
 * It stays a disciplined surface over the shared object store — "one object,
 * many apps". Editing mechanics belong to Editor Core; file bytes to Files
 * Core; presentation to the apps. AI uses this Core to create, link,
 * summarize, transform, and retrieve structured user objects.
 */

import {
  liveObjects,
  createObject,
  updateObject,
  deleteObject,
  getObject,
  convertObjectType,
  trashObject,
  restoreTrashedObject,
  trashedObjects,
  mintDestructiveToken,
  consumeDestructiveToken,
  subscribe as subscribeObjects,
} from "../objects";
import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { todayLocal } from "./time";
import type { ObjectType, SystemObject, TaskPriority } from "@/types";

/** The object types Cardspoke Core owns. */
export const CARDSPOKE_TYPES: ObjectType[] = ["card", "task", "document"];

export type CardspokeType = "card" | "task" | "document";

export function isCardspokeObject(o: SystemObject): boolean {
  return CARDSPOKE_TYPES.includes(o.type);
}

export function allCards(): SystemObject[] {
  return liveObjects().filter(isCardspokeObject);
}

export const subscribeCards = subscribeObjects;

/* --------------------------------- create ---------------------------------- */

export interface CreateCardInput {
  type: CardspokeType;
  title: string;
  body?: string;
  tags?: string[];
  projectIds?: string[];
  /** Task-only conveniences. */
  due?: string;
  priority?: TaskPriority;
}

/** Merge explicit tags with #inline-tags found in the body (user tags win the
    ordering; duplicates collapse case-insensitively). */
function withInlineTags(tags: string[] | undefined, body: string | undefined): string[] {
  const out: string[] = [...(tags ?? [])];
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const t of extractInlineTags(body)) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function createCard(input: CreateCardInput): SystemObject {
  return createObject({
    type: input.type,
    title: input.title,
    body: input.body,
    tags: withInlineTags(input.tags, input.body),
    projectIds: input.projectIds,
    task:
      input.type === "task"
        ? { done: false, priority: input.priority ?? "normal", due: input.due }
        : undefined,
    card: input.type === "card" ? { links: [] } : undefined,
  });
}

export function updateCard(
  id: string,
  patch: { title?: string; body?: string; tags?: string[] },
): SystemObject | undefined {
  const o = getObject(id);
  // Ownership guard: Cardspoke only edits the types it owns (card/task/
  // document). Without this, updateCard could rewrite a File's fields and
  // bypass Files Core, which owns file lifecycle.
  if (!o || !isCardspokeObject(o)) return undefined;
  const next = { ...patch };
  // Saving a body through the Core keeps inline #tags in sync — both ways.
  // Tags derived from the previous body are recomputed from the new body;
  // hand-set tags are kept. Without the subtraction, per-keystroke saves
  // accrete every partial prefix (#p, #pr, #pro…) and a #tag deleted from
  // the body could never leave the tag list.
  if (patch.body !== undefined) {
    const baseTags = patch.tags ?? o.tags;
    const previousInline = new Set(extractInlineTags(o.body));
    const manual = baseTags.filter((t) => !previousInline.has(t.toLowerCase()));
    next.tags = withInlineTags(manual, patch.body);
  }
  return updateObject(id, next);
}

/**
 * Delete = recoverable trash (Wave 3). A card/task/document leaves every
 * listing and AI surface but can be restored; permanent removal only happens
 * through purgeCardTrash with an explicit confirmation token. There is no
 * unrecoverable one-call delete on this path anymore.
 */
export function deleteCard(id: string): void {
  const o = getObject(id);
  // Ownership guard: never touch a non-Cardspoke object (e.g. a File,
  // which has its own recoverable trash) through this path.
  if (!o || !isCardspokeObject(o)) return;
  trashObject(id);
}

export function restoreCard(id: string): SystemObject | undefined {
  const o = getObject(id);
  if (!o || !isCardspokeObject(o)) return undefined;
  return restoreTrashedObject(id);
}

/** Cardspoke objects currently in the generic trash. */
export function trashedCards(): SystemObject[] {
  return trashedObjects().filter(isCardspokeObject);
}

/** Step 1 of emptying the Cardspoke trash: mint the confirmation token. */
export function requestCardTrashPurge(): { token: string; count: number } {
  return { token: mintDestructiveToken("cardspoke.trash"), count: trashedCards().length };
}

/**
 * Step 2: permanently delete everything in the Cardspoke trash. Requires the
 * token from requestCardTrashPurge (one-shot, short-lived) — a stale confirm
 * dialog cannot destroy objects trashed after it was shown. A recovery
 * manifest of what was destroyed goes on the audit record.
 */
export function purgeCardTrash(token: string): number {
  if (!consumeDestructiveToken("cardspoke.trash", token)) {
    record({
      type: "system.event",
      summary: "Cardspoke Core: trash purge refused — missing or expired confirmation token",
    });
    return 0;
  }
  const trashed = trashedCards();
  for (const o of trashed) deleteObject(o.id);
  if (trashed.length > 0) {
    record({
      type: "object.deleted",
      summary: `Cardspoke Core: trash emptied (${trashed.length} object${trashed.length === 1 ? "" : "s"} permanently deleted)`,
      detail: `Deleted: ${trashed.map((o) => `“${o.title || "Untitled"}” (${o.id})`).join(", ").slice(0, 600)}`,
    });
  }
  return trashed.length;
}

/* ----------------------- wiki-links (CardSpoke kernel) ---------------------- */

/** Normalize a title for comparison (lowercase, trimmed, collapsed spaces). */
export function normalizeTitle(title: string): string {
  return (title ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

export interface WikiLink {
  match: string;
  title: string;
  startIndex: number;
  endIndex: number;
}

/** Parse [[Card Name]] link tokens from text. Brackets cannot nest, so
    `[[[Title]]]` resolves the inner `[[Title]]`. */
export function parseWikiLinks(text: string | undefined): WikiLink[] {
  if (!text) return [];
  const regex = /\[\[([^[\]]+)\]\]/g;
  const out: WikiLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    out.push({
      match: m[0],
      title: m[1].trim(),
      startIndex: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return out;
}

/** Does the text contain a [[title]] link to the given title? */
export function hasWikiLink(text: string | undefined, title: string): boolean {
  if (!text || !title) return false;
  const normalized = normalizeTitle(title);
  return parseWikiLinks(text).some((l) => normalizeTitle(l.title) === normalized);
}

/** Extract inline #tags from body text (capped at 5 unique tags, like the
    CardSpoke kernel). Dedupes case-insensitively before capping, so a
    same-tag repeat earlier in the body cannot crowd out a later distinct tag. */
export function extractInlineTags(body: string | undefined): string[] {
  if (!body) return [];
  const matches = body.match(/#\w+/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const tag = m.slice(1).toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === 5) break;
  }
  return out;
}

/* ------------------------- title index (backlink cache) --------------------- */

// A normalized-title → objects index, rebuilt lazily and invalidated on any
// object write — kills the per-call quadratic scan behind findByTitle and
// backlinksFor without changing their semantics.
let titleIndex: Map<string, SystemObject[]> | null = null;
let indexWatcherStarted = false;

function ensureIndexWatcher(): void {
  if (indexWatcherStarted) return;
  indexWatcherStarted = true;
  subscribeObjects(() => {
    titleIndex = null;
  });
}

function getTitleIndex(): Map<string, SystemObject[]> {
  ensureIndexWatcher();
  if (titleIndex) return titleIndex;
  titleIndex = new Map();
  for (const o of allCards()) {
    const key = normalizeTitle(o.title);
    if (!key) continue;
    const list = titleIndex.get(key);
    if (list) list.push(o);
    else titleIndex.set(key, [o]);
  }
  return titleIndex;
}

/**
 * Find a Cardspoke object by title (case-insensitive, space-normalized).
 * Duplicate titles resolve deterministically: the most recently updated wins.
 */
export function findByTitle(title: string): SystemObject | undefined {
  const normalized = normalizeTitle(title);
  if (!normalized) return undefined;
  const matches = getTitleIndex().get(normalized);
  if (!matches || matches.length === 0) return undefined;
  return matches.length === 1
    ? matches[0]
    : [...matches].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export interface ResolvedWikiLink {
  link: WikiLink;
  objectId: string | null;
}

/** Resolve every [[Title]] in a text to an object id (or null if unmatched). */
export function resolveWikiLinks(text: string | undefined): ResolvedWikiLink[] {
  return parseWikiLinks(text).map((link) => ({
    link,
    objectId: findByTitle(link.title)?.id ?? null,
  }));
}

/* ------------------------------- relationships ----------------------------- */

/** Link two cards (bidirectional, idempotent). Card-typed objects only. */
export function linkCards(aId: string, bId: string): void {
  const a = getObject(aId);
  const b = getObject(bId);
  if (!a?.card || !b?.card) return;
  if (!a.card.links.includes(bId)) {
    updateObject(aId, { card: { ...a.card, links: [...a.card.links, bId] } }, { silent: true });
  }
  if (!b.card.links.includes(aId)) {
    updateObject(bId, { card: { ...b.card, links: [...b.card.links, aId] } }, { silent: true });
  }
}

/** Remove an explicit link between two cards, both directions (idempotent). */
export function unlinkCards(aId: string, bId: string): void {
  const a = getObject(aId);
  const b = getObject(bId);
  if (a?.card?.links.includes(bId)) {
    updateObject(
      aId,
      { card: { ...a.card, links: a.card.links.filter((l) => l !== bId) } },
      { silent: true },
    );
  }
  if (b?.card?.links.includes(aId)) {
    updateObject(
      bId,
      { card: { ...b.card, links: b.card.links.filter((l) => l !== aId) } },
      { silent: true },
    );
  }
}

/**
 * Everything this object points at: explicit card links plus [[Title]] links
 * resolved from its body. Works for any Cardspoke shape.
 */
export function linksFor(id: string): SystemObject[] {
  const o = getObject(id);
  if (!o) return [];
  const ids = new Set<string>(o.card?.links ?? []);
  for (const { objectId } of resolveWikiLinks(o.body)) {
    if (objectId && objectId !== id) ids.add(objectId);
  }
  return [...ids].map((x) => getObject(x)).filter((x): x is SystemObject => !!x);
}

/**
 * Everything that points at this object: explicit card links naming it plus
 * any Cardspoke object whose body wiki-links RESOLVE to it. Resolution — not
 * a raw title comparison — is the test, so backlink reporting always agrees
 * with deterministic wiki-link resolution: with duplicate titles, only the
 * object [[Title]] actually resolves to (most recently updated) reports the
 * backlink, exactly mirroring where the link navigates.
 */
export function backlinksFor(id: string): SystemObject[] {
  const target = getObject(id);
  if (!target) return [];
  const out: SystemObject[] = [];
  for (const o of allCards()) {
    if (o.id === id) continue;
    const explicit = o.card?.links.includes(id) ?? false;
    const byTitle = resolveWikiLinks(o.body).some((r) => r.objectId === id);
    if (explicit || byTitle) out.push(o);
  }
  return out;
}

export interface RelatedHit {
  object: SystemObject;
  matchedTags: string[];
  /** 0–1: shared tags over the larger tag set (CardSpoke kernel scoring). */
  score: number;
}

/** Related Cardspoke objects by shared tags, best match first. */
export function relatedByTags(id: string, limit = 10): RelatedHit[] {
  const o = getObject(id);
  if (!o || o.tags.length === 0) return [];
  const mine = o.tags.map((t) => t.toLowerCase());
  const hits: RelatedHit[] = [];
  for (const other of allCards()) {
    if (other.id === id) continue;
    const theirs = other.tags.map((t) => t.toLowerCase());
    const matchedTags = mine.filter((t) => theirs.includes(t));
    if (matchedTags.length > 0) {
      hits.push({
        object: other,
        matchedTags,
        score: matchedTags.length / Math.max(mine.length, theirs.length),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* --------------------------------- status ---------------------------------- */

export function setCardStatus(id: string, done: boolean): void {
  const o = getObject(id);
  if (!o?.task) return;
  updateObject(id, { task: { ...o.task, done } });
}

export function setCardPriority(id: string, priority: TaskPriority): void {
  const o = getObject(id);
  if (!o?.task) return;
  updateObject(id, { task: { ...o.task, priority } });
}

/** Set a task's due date. Timing *logic* (reminders, overdue watches) lives in
    Time Core and Monitor Core — this is only the card's own field. */
export function setCardDue(id: string, due: string | undefined): void {
  const o = getObject(id);
  if (!o?.task) return;
  updateObject(id, { task: { ...o.task, due } });
}

/* -------------------------------- conversion ------------------------------- */

/**
 * note/card ↔ task ↔ document, preserving id, links, tags, and projects.
 * Lossless: the outgoing sub-record is snapshotted (previousShape), so a
 * task → card → task round trip restores due date and completion exactly.
 */
export function convertCard(id: string, to: CardspokeType): SystemObject | undefined {
  const o = getObject(id);
  // Ownership guard: only convert Cardspoke-owned objects, and only into
  // Cardspoke types — a File id must not be converted into a task, which would
  // strip its file record and bypass Files ownership.
  if (!o || !isCardspokeObject(o) || !CARDSPOKE_TYPES.includes(to)) return undefined;
  return convertObjectType(id, to);
}

/** Revert a converted object to its recorded previous shape (if any). */
export function revertConversion(id: string): SystemObject | undefined {
  const o = getObject(id);
  const back = o?.previousShape?.type ?? o?.previousType;
  if (!o || !back || !CARDSPOKE_TYPES.includes(back)) return undefined;
  return convertObjectType(id, back);
}

/* ------------------------ outline → tasks conversion ------------------------ */

/**
 * Bullet / checklist lines in a body — the convertible outline items.
 * Markdown horizontal rules (`---`, `***`) and emphasis (`*word*`) are not
 * outline items: a bullet needs whitespace after its marker.
 */
export function outlineItems(body: string | undefined): string[] {
  if (!body) return [];
  return body
    .split("\n")
    .filter((line) => !/^\s*(?:[-*_]\s*){3,}$/.test(line))
    .map((line) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?(.+)$/)?.[1]?.trim())
    .filter((t): t is string => !!t);
}

/**
 * Turn an outline (a note or document with bullet lines) into task objects —
 * the CardSpoke "project from outline" conversion adapted to the flat store.
 * Each bullet becomes a task inheriting the source's tags and projects.
 * Idempotent: bullets that already exist as tasks (by normalized title) are
 * skipped, so running it twice creates no duplicates.
 */
export function convertOutlineToTasks(id: string): SystemObject[] {
  const source = getObject(id);
  if (!source || !isCardspokeObject(source)) return [];
  const existing = new Set(
    liveObjects()
      .filter((o) => o.type === "task")
      .map((o) => normalizeTitle(o.title)),
  );
  const items = outlineItems(source.body).filter((t) => !existing.has(normalizeTitle(t)));
  const created = items.map((title) =>
    createObject({
      type: "task",
      title,
      tags: source.tags,
      projectIds: source.projectIds,
      task: { done: false, priority: "normal" },
    }),
  );
  if (created.length > 0) {
    record({
      type: "object.converted",
      summary: `Cardspoke Core: outline “${source.title || "Untitled"}” became ${created.length} task${created.length === 1 ? "" : "s"}`,
    });
  }
  return created;
}

/* ------------------------------ typed queries ------------------------------- */

/** Open tasks due today (local calendar day — F2). */
export function tasksDueToday(): SystemObject[] {
  const today = todayLocal();
  return liveObjects().filter((o) => o.type === "task" && !o.task?.done && o.task?.due === today);
}

/** Open tasks whose due date has passed (local calendar day — F2). */
export function overdueTasks(): SystemObject[] {
  const today = todayLocal();
  return liveObjects().filter(
    (o) => o.type === "task" && !o.task?.done && !!o.task?.due && o.task.due < today,
  );
}

export function findByTypeAndTag(type: CardspokeType, tag: string): SystemObject[] {
  const normalized = tag.replace(/^#/, "").toLowerCase().trim();
  if (!normalized) return [];
  return liveObjects().filter(
    (o) => o.type === type && o.tags.some((t) => t.toLowerCase() === normalized),
  );
}

/**
 * A saved filter — the CardSpoke "collection" concept: a reusable query over
 * the shared store that any app or the AI can evaluate. Fields AND-combine.
 */
export interface SavedFilter {
  type?: CardspokeType;
  tag?: string;
  /** Task completion — only meaningful for tasks, so it scopes to them. */
  done?: boolean;
  /** ISO date (yyyy-mm-dd): tasks due strictly before this date. */
  dueBefore?: string;
  projectId?: string;
}

export function evaluateFilter(filter: SavedFilter): SystemObject[] {
  const tag = filter.tag?.replace(/^#/, "").toLowerCase().trim();
  return allCards().filter((o) => {
    if (filter.type && o.type !== filter.type) return false;
    if (tag && !o.tags.some((t) => t.toLowerCase() === tag)) return false;
    // done/dueBefore describe task state: they match tasks only, instead of
    // sweeping in every card and document as "not done".
    if (filter.done !== undefined && (o.type !== "task" || (o.task?.done ?? false) !== filter.done))
      return false;
    if (filter.dueBefore && !(o.type === "task" && o.task?.due && o.task.due < filter.dueBefore))
      return false;
    if (filter.projectId && !o.projectIds.includes(filter.projectId)) return false;
    return true;
  });
}

/* ------------------------------ saved filters ------------------------------- */

/** A persisted, named saved filter — a user feature, not just an API shape. */
export interface NamedFilter extends SavedFilter {
  id: string;
  name: string;
  createdAt: number;
}

let filterCache: NamedFilter[] | null = null;

function loadFilters(): NamedFilter[] {
  if (filterCache === null) filterCache = storage.get<NamedFilter[]>(StoreKeys.savedFilters, []);
  return filterCache;
}

export function listSavedFilters(): NamedFilter[] {
  return loadFilters();
}

export function subscribeSavedFilters(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.savedFilters, () => {
    filterCache = storage.get<NamedFilter[]>(StoreKeys.savedFilters, []);
    fn();
  });
}

export function saveFilter(name: string, filter: SavedFilter): NamedFilter {
  const named: NamedFilter = {
    ...filter,
    id: `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Untitled filter",
    createdAt: Date.now(),
  };
  filterCache = [named, ...loadFilters()];
  storage.set(StoreKeys.savedFilters, filterCache);
  record({ type: "system.event", summary: `Cardspoke Core: saved filter “${named.name}”` });
  return named;
}

export function removeSavedFilter(id: string): void {
  filterCache = loadFilters().filter((f) => f.id !== id);
  storage.set(StoreKeys.savedFilters, filterCache);
}

/* ----------------------------------- AI ------------------------------------ */

/**
 * A compact, relationship-aware description of one object for AI context.
 * Retrieval goes through Search / Index Core (which redacts); this is the
 * per-object shape the assistant reasons over.
 */
export function cardForAI(id: string): string | null {
  const o = getObject(id);
  if (!o || !isCardspokeObject(o)) return null;
  const links = linksFor(id);
  const backlinks = backlinksFor(id);
  const parts = [
    `${o.type}: “${o.title || "Untitled"}”`,
    o.task ? `${o.task.done ? "done" : "open"}${o.task.due ? `, due ${o.task.due}` : ""}` : "",
    o.tags.length ? `tags: ${o.tags.join(", ")}` : "",
    links.length ? `links to: ${links.map((l) => l.title).join(", ")}` : "",
    backlinks.length ? `linked from: ${backlinks.map((l) => l.title).join(", ")}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
