/*
 * The object store — the local-first spine of "one object, many apps".
 * ---------------------------------------------------------------------------
 * Every user-created datum (documents, cards, tasks, projects, files, memory)
 * lives here, in one array persisted through core/storage. Apps read and write
 * through this module instead of keeping private silos, so Search, Projects,
 * and the indexer all see the same truth.
 *
 * Like audit.ts, it keeps a small in-memory cache and re-hydrates on external
 * writes (including other tabs) so useSyncExternalStore stays cheap.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";
import { emit } from "./events";
import type {
  ObjectType,
  SystemObject,
  IndexState,
  ConversionShape,
} from "@/types";
import { OBJECT_TYPE_META } from "@/types";

let cache: SystemObject[] | null = null;

let seq = 0;
function makeId(prefix = "obj"): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${rand}`;
}

function load(): SystemObject[] {
  if (cache === null) {
    cache = storage.get<SystemObject[]>(StoreKeys.objects, []);
  }
  return cache;
}

function persist(next: SystemObject[]): void {
  cache = next;
  storage.set(StoreKeys.objects, next);
}

export function allObjects(): SystemObject[] {
  return load();
}

/** Is this object soft-deleted — generic trash or Files Core's file trash? */
export function isObjectTrashed(o: SystemObject): boolean {
  return !!o.trashedAt || !!o.file?.deletedAt;
}

/** Every object that is not in a trash (the default read for listings). */
export function liveObjects(): SystemObject[] {
  return load().filter((o) => !isObjectTrashed(o));
}

/** Objects of a type. Trashed objects are excluded unless explicitly asked
    for — a trashed task must not keep appearing in task lists. */
export function objectsOfType(
  type: ObjectType,
  opts: { includeTrashed?: boolean } = {},
): SystemObject[] {
  return load().filter(
    (o) => o.type === type && (opts.includeTrashed || !isObjectTrashed(o)),
  );
}

export function getObject(id: string): SystemObject | undefined {
  return load().find((o) => o.id === id);
}

/** Everything a caller must provide to create an object; the rest is defaulted. */
export interface CreateInput {
  type: ObjectType;
  title: string;
  body?: string;
  tags?: string[];
  projectIds?: string[];
  source?: string;
  task?: SystemObject["task"];
  file?: SystemObject["file"];
  card?: SystemObject["card"];
  project?: SystemObject["project"];
  memory?: SystemObject["memory"];
}

export function createObject(input: CreateInput): SystemObject {
  const now = Date.now();
  const obj: SystemObject = {
    id: makeId(input.type),
    type: input.type,
    title: input.title,
    body: input.body,
    createdAt: now,
    updatedAt: now,
    rev: 1,
    tags: input.tags ?? [],
    projectIds: input.projectIds ?? [],
    source: input.source ?? "local",
    // New local objects are unindexed until the indexer runs.
    indexState: "unindexed",
    task: input.task,
    file: input.file,
    card: input.card,
    project: input.project,
    memory: input.memory,
  };
  persist([obj, ...load()]);
  record({
    type: "object.created",
    summary: `${OBJECT_TYPE_META[obj.type].label} created: “${obj.title || "Untitled"}”`,
    skipEmit: true, // the bus event below carries the object itself
  });
  emit("object.created", obj);
  return obj;
}

/**
 * Patch an object. Any content-bearing edit bumps `updatedAt` and marks the
 * index stale so the indexer knows to refresh its summary. Pass
 * `{ silent: true }` for structural changes that should not touch the index
 * (e.g. re-indexing itself).
 */
export function updateObject(
  id: string,
  patch: Partial<Omit<SystemObject, "id" | "type" | "createdAt">>,
  opts: { silent?: boolean } = {},
): SystemObject | undefined {
  let updated: SystemObject | undefined;
  const next = load().map((o) => {
    if (o.id !== id) return o;
    const touchesContent =
      patch.title !== undefined ||
      patch.body !== undefined ||
      patch.tags !== undefined;
    updated = {
      ...o,
      ...patch,
      updatedAt: Date.now(),
      // The monotonic version token: every write bumps it, so same-ms writes
      // are still distinguishable (Editor stale-base detection).
      rev: (o.rev ?? 0) + 1,
      indexState:
        patch.indexState ??
        (touchesContent && !opts.silent && o.indexState === "indexed"
          ? "stale"
          : o.indexState),
    };
    return updated;
  });
  if (updated) {
    persist(next);
    // Live signal only — an audit row per keystroke would drown the log.
    emit("object.updated", updated);
  }
  return updated;
}

/**
 * Re-insert a previously deleted object verbatim (broker undo of a delete).
 * Fails soft if the id is somehow live again.
 */
export function restoreObject(obj: SystemObject): SystemObject {
  if (getObject(obj.id)) return obj;
  persist([obj, ...load()]);
  record({
    type: "object.created",
    summary: `${OBJECT_TYPE_META[obj.type].label} restored: “${obj.title || "Untitled"}”`,
    skipEmit: true,
  });
  emit("object.created", obj);
  return obj;
}

/**
 * Convert an object between the Cardspoke types (note/card ↔ task ↔ document)
 * keeping its id, so links and project memberships survive. Used by Cardspoke
 * Core. The conversion is lossless: the *entire* outgoing sub-record is
 * snapshotted (previousShape), so converting a task to a card and back
 * restores its due date and completion. Round-tripping to the type held in
 * the snapshot restores it instead of defaulting.
 */
export function convertObjectType(id: string, to: ObjectType): SystemObject | undefined {
  let updated: SystemObject | undefined;
  const next = load().map((o) => {
    if (o.id !== id || o.type === to) return o;
    // Snapshot the outgoing shape under its own type key, preserving every
    // earlier type's snapshot too — so a multi-hop conversion
    // (task→card→document→task) restores the original task's due/completion
    // instead of losing it when a single `previousShape` was overwritten.
    const shapes: Partial<Record<ObjectType, ConversionShape>> = {
      ...(o.previousShapes ?? {}),
    };
    const outgoing = {
      type: o.type,
      task: o.task,
      card: o.card,
      project: o.project,
      file: o.file,
      memory: o.memory,
    };
    shapes[o.type] = outgoing;
    // Restore from the snapshot when converting back to a previously-held type.
    const restored = shapes[to];
    delete shapes[to];
    updated = {
      ...o,
      type: to,
      // previousType/previousShape describe the immediate previous shape (for
      // display + single-step revert); previousShapes keeps the full history.
      previousType: o.type,
      previousShape: outgoing,
      previousShapes: shapes,
      updatedAt: Date.now(),
      rev: (o.rev ?? 0) + 1,
      indexState: o.indexState === "indexed" ? "stale" : o.indexState,
      task: to === "task" ? restored?.task ?? o.task ?? { done: false, priority: "normal" } : undefined,
      card: to === "card" ? restored?.card ?? o.card ?? { links: [] } : undefined,
      project: to === "project" ? restored?.project ?? o.project ?? { summary: "" } : undefined,
      file: to === "file" ? restored?.file ?? o.file : undefined,
      memory: to === "memory" ? restored?.memory ?? o.memory ?? { scope: "user" } : undefined,
    };
    return updated;
  });
  if (updated) {
    persist(next);
    record({
      type: "object.converted",
      summary: `Converted “${updated.title || "Untitled"}” to a ${OBJECT_TYPE_META[to].label.toLowerCase()}`,
    });
  }
  return updated;
}

/**
 * Generic soft delete (Wave 3): the object leaves every listing, search,
 * index, and AI surface but stays recoverable. This — not deleteObject — is
 * the normal "delete" path for user-facing surfaces; hard deletion is
 * reserved for purging an already-trashed object with an explicit
 * confirmation token, and for the Broker's own undo bookkeeping.
 */
export function trashObject(id: string): SystemObject | undefined {
  const o = getObject(id);
  if (!o || isObjectTrashed(o)) return o ?? undefined;
  const next = updateObject(
    id,
    {
      trashedAt: Date.now(),
      restoreIndexState: o.indexState,
      indexState: "excluded",
      excludedBy: "trash",
    },
    { silent: true },
  );
  record({
    type: "object.trashed",
    summary: `${OBJECT_TYPE_META[o.type].label} moved to trash (recoverable): “${o.title || "Untitled"}”`,
    skipEmit: true,
  });
  emit("object.trashed", next);
  return next;
}

export function restoreTrashedObject(id: string): SystemObject | undefined {
  const o = getObject(id);
  if (!o || !o.trashedAt) return o ?? undefined;
  const next = updateObject(
    id,
    {
      trashedAt: undefined,
      restoreIndexState: undefined,
      // Excluded stays excluded; anything else re-indexes as stale.
      indexState: o.restoreIndexState === "excluded" ? "excluded" : "stale",
      // A restored object that stays excluded was excluded by the user before
      // it was trashed; otherwise the trash provenance clears with the trash.
      excludedBy: o.restoreIndexState === "excluded" ? "user" : undefined,
    },
    { silent: true },
  );
  record({
    type: "object.restored",
    summary: `${OBJECT_TYPE_META[o.type].label} restored from trash: “${o.title || "Untitled"}”`,
    skipEmit: true,
  });
  emit("object.restored", next);
  return next;
}

/** Objects in the generic trash (files keep their own trash in Files Core). */
export function trashedObjects(): SystemObject[] {
  return load().filter((o) => !!o.trashedAt);
}

/* -------------------- destructive confirmation tokens ----------------------- */

/*
 * A permanent deletion (emptying a trash) is a two-step Core-level contract:
 * mint a token naming the scope, then spend it within its lifetime. A caller
 * cannot destroy data in one call, and a stale confirmation dialog cannot
 * destroy data that changed since it was shown.
 */
const DESTRUCTIVE_TOKEN_TTL_MS = 60_000;
const destructiveTokens = new Map<string, { scope: string; at: number }>();

export function mintDestructiveToken(scope: string): string {
  const token = `confirm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  destructiveTokens.set(token, { scope, at: Date.now() });
  return token;
}

/** One-shot: valid only for the same scope, within the TTL. */
export function consumeDestructiveToken(scope: string, token: string): boolean {
  const entry = destructiveTokens.get(token);
  destructiveTokens.delete(token);
  return !!entry && entry.scope === scope && Date.now() - entry.at <= DESTRUCTIVE_TOKEN_TTL_MS;
}

export function deleteObject(id: string): void {
  const obj = getObject(id);
  const next = load().filter((o) => o.id !== id);
  // Also drop this id from any card links and project memberships.
  const cleaned = next.map((o) => {
    let out = o;
    if (out.card?.links.includes(id)) {
      out = { ...out, card: { ...out.card, links: out.card.links.filter((l) => l !== id) } };
    }
    if (out.projectIds.includes(id)) {
      out = { ...out, projectIds: out.projectIds.filter((p) => p !== id) };
    }
    return out;
  });
  persist(cleaned);
  if (obj) {
    record({
      type: "object.deleted",
      summary: `${OBJECT_TYPE_META[obj.type].label} deleted: “${obj.title || "Untitled"}”`,
      skipEmit: true,
    });
    emit("object.deleted", obj);
  }
}

/** Link an object into a project (idempotent). */
export function linkToProject(objectId: string, projectId: string): void {
  const obj = getObject(objectId);
  if (!obj || obj.projectIds.includes(projectId)) return;
  updateObject(objectId, { projectIds: [...obj.projectIds, projectId] }, { silent: true });
}

export function unlinkFromProject(objectId: string, projectId: string): void {
  const obj = getObject(objectId);
  if (!obj) return;
  updateObject(
    objectId,
    { projectIds: obj.projectIds.filter((p) => p !== projectId) },
    { silent: true },
  );
}

export function objectsInProject(projectId: string): SystemObject[] {
  return load().filter((o) => o.projectIds.includes(projectId));
}

export interface SearchHit {
  object: SystemObject;
  /** Lower is better: index of the earliest match. */
  score: number;
  /** Which field matched, for a small hint in the UI. */
  field: "title" | "body" | "tag";
}

/** Case-insensitive substring search across title, body, and tags. */
export function searchObjects(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const object of load()) {
    const title = object.title.toLowerCase();
    const ti = title.indexOf(q);
    if (ti !== -1) {
      hits.push({ object, score: ti, field: "title" });
      continue;
    }
    const tag = object.tags.find((t) => t.toLowerCase().includes(q));
    if (tag) {
      hits.push({ object, score: 100, field: "tag" });
      continue;
    }
    const bi = (object.body ?? "").toLowerCase().indexOf(q);
    if (bi !== -1) hits.push({ object, score: 200 + bi, field: "body" });
  }
  return hits.sort((a, b) => a.score - b.score);
}

export function setIndexState(id: string, state: IndexState): void {
  // A direct exclusion through this API is the USER's explicit decision —
  // index passes must never revive it (unlike a source-pattern exclusion).
  updateObject(
    id,
    { indexState: state, excludedBy: state === "excluded" ? "user" : undefined },
    { silent: true },
  );
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.objects, () => {
    cache = storage.get<SystemObject[]>(StoreKeys.objects, []);
    fn();
  });
}

/**
 * Seed a realistic local dataset the first time the OS runs. Deliberately
 * cross-linked (cards ↔ projects, tasks ↔ projects) so Projects, Search, and
 * the indexer have something true to show. Runs once; user edits win forever
 * after.
 */
export function seedIfEmpty(): void {
  if (load().length > 0) return;
  const now = Date.now();
  const mk = (
    id: string,
    partial: Omit<SystemObject, "id" | "createdAt" | "updatedAt" | "source" | "indexState"> &
      Partial<Pick<SystemObject, "indexState">>,
  ): SystemObject => ({
    id,
    createdAt: now,
    updatedAt: now,
    source: "local",
    indexState: partial.indexState ?? "indexed",
    ...partial,
  });

  const seeded: SystemObject[] = [
    mk("project-locus", {
      type: "project",
      title: "Locus OS",
      tags: ["core"],
      projectIds: [],
      project: { summary: "The local-first workspace shell you are looking at." },
    }),
    mk("project-album", {
      type: "project",
      title: "Exposure Therapy",
      tags: ["music"],
      projectIds: [],
      project: { summary: "Album preproduction: sequencing, sheet music, and release plan." },
    }),
    mk("doc-fieldnotes", {
      type: "document",
      title: "Field notes",
      body:
        "# Field notes\n\nStart writing in **Markdown**.\n\n- Owned as plain text\n- Portable by design\n- Open to the AI only when you allow it\n",
      tags: ["notes"],
      projectIds: ["project-locus"],
    }),
    mk("doc-release", {
      type: "document",
      title: "Release plan",
      body: "# Release plan\n\nSequencing and dates for the record.\n",
      tags: ["plan"],
      projectIds: ["project-album"],
    }),
    mk("card-localfirst", {
      type: "card",
      title: "Local-first principles",
      body:
        "Data lives on the device first. The network is an enhancement, not a requirement. The user can always take their data and leave.",
      tags: ["philosophy", "core"],
      projectIds: ["project-locus"],
      card: { links: ["card-untrusted"] },
    }),
    mk("card-untrusted", {
      type: "card",
      title: "AI as an untrusted actor",
      body:
        "The AI is a capable assistant with no standing authority. Every action it takes is granted, visible, and revocable.",
      tags: ["ai", "permissions"],
      projectIds: ["project-locus"],
      card: { links: ["card-localfirst"] },
    }),
    mk("card-lens", {
      type: "card",
      title: "One object, many apps",
      body:
        "A card, a task, a document, and a file are shared objects. Apps are lenses onto the same data, not silos that trap it.",
      tags: ["architecture"],
      projectIds: ["project-locus"],
      card: { links: [] },
    }),
    mk("task-palette", {
      type: "task",
      title: "Wire the command palette",
      tags: [],
      projectIds: ["project-locus"],
      task: { done: true, priority: "normal" },
    }),
    mk("task-tiers", {
      type: "task",
      title: "Define AI capability tiers",
      tags: [],
      projectIds: ["project-locus"],
      task: { done: true, priority: "high" },
    }),
    mk("task-files", {
      type: "task",
      title: "Sketch the Files app",
      tags: [],
      projectIds: ["project-locus"],
      task: { done: false, priority: "normal" },
    }),
    mk("task-sequence", {
      type: "task",
      title: "Finalize the track sequence",
      tags: [],
      projectIds: ["project-album"],
      task: { done: false, priority: "high" },
    }),
    mk("file-cover", {
      type: "file",
      title: "cover-draft.png",
      tags: ["reference"],
      projectIds: ["project-album"],
      file: { kind: "image", sizeBytes: 1.1 * 1024 * 1024, ref: "/exposure/cover-draft.png" },
    }),
    mk("file-wav", {
      type: "file",
      title: "back-and-forth.wav",
      tags: [],
      projectIds: ["project-album"],
      file: { kind: "audio", sizeBytes: 38 * 1024 * 1024, ref: "/exposure/back-and-forth.wav" },
    }),
    mk("memory-name", {
      type: "memory",
      title: "Prefers to be called by first name",
      body: "The user prefers a calm, direct tone and a first-name address.",
      tags: [],
      projectIds: [],
      memory: { scope: "user" },
    }),
  ];
  persist(seeded);
}
