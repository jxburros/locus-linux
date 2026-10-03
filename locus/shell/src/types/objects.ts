/*
 * The system object model.
 * ---------------------------------------------------------------------------
 * Locus's data commitment is "one object, many apps": a card, a task, a
 * document, and a file are the *same kind of thing* wearing different clothes.
 * Every user-created datum is a SystemObject in one local store. Apps are
 * lenses onto that store, not silos that trap data — which is what lets Search
 * find everything, Projects link anything, and the indexer summarize it all.
 *
 * A single flat interface (with optional, type-specific sub-records) keeps the
 * store code simple and the localStorage shape self-describing. Discriminate on
 * `type` and read the matching sub-record.
 */

/** The kinds of thing a user can own. Mirrors the spec's data/object model. */
export type ObjectType =
  | "document"
  | "card"
  | "task"
  | "project"
  | "file"
  | "memory";

/**
 * Where an object's index sits. Reads are broad, but an object can be held
 * back from the index (excluded) or flagged for re-indexing (stale).
 */
export type IndexState = "unindexed" | "indexed" | "excluded" | "stale";

/**
 * WHY an object is excluded from the index — independent provenance, so one
 * reason cannot silently overwrite another: a source-pattern exclusion may be
 * lifted by an index pass when the pattern no longer matches, but a user's
 * explicit exclusion and trash state belong to the user/owning Core and are
 * never revived by indexing.
 */
export type ExclusionReason = "user" | "source-pattern" | "trash";

export type TaskPriority = "low" | "normal" | "high";
export type FileKind = "folder" | "doc" | "audio" | "image" | "video" | "other";
export type MemoryScope = "user" | "project" | "app" | "agent" | "model";

export interface TaskFields {
  done: boolean;
  /** ISO date string (yyyy-mm-dd) or undefined. Kept as a string for portability. */
  due?: string;
  priority: TaskPriority;
}

export interface FileFields {
  kind: FileKind;
  sizeBytes?: number;
  /** A path or opaque reference into a connected source. No raw handles in v1. */
  ref?: string;
  /** A short, locally-derived summary the indexer can produce. */
  summary?: string;
  /** Set when the file is in the trash (Files Core soft delete). */
  deletedAt?: number;
  /** The index state the file held before it was trashed, so restore can
      put it back — a deliberately excluded file must stay excluded. */
  restoreIndexState?: IndexState;
}

export interface CardFields {
  /** Ids of other objects this card links to (a lightweight knowledge graph). */
  links: string[];
}

export interface ProjectFields {
  summary: string;
}

export interface MemoryFields {
  scope: MemoryScope;
}

/** A snapshot of one object shape's type-specific sub-records, for conversion. */
export interface ConversionShape {
  type: ObjectType;
  task?: TaskFields;
  file?: FileFields;
  card?: CardFields;
  project?: ProjectFields;
  memory?: MemoryFields;
}

/**
 * One user-owned object. `type` selects which of the optional sub-records is
 * present. `body` carries the primary text for text-bearing objects.
 */
export interface SystemObject {
  id: string;
  type: ObjectType;
  title: string;
  /** Primary text payload for documents, cards, and memory. Markdown for docs. */
  body?: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Monotonic revision, bumped on every write. The version token for
   * stale-base detection (Editor transactions): two writes in the same
   * millisecond produce distinct revisions where `updatedAt` could not.
   */
  rev?: number;
  tags: string[];
  /** Projects this object is linked into (project objects have their own id here empty). */
  projectIds: string[];
  /** "local" for the built-in store, or a connected source id once sources exist. */
  source: string;
  indexState: IndexState;
  /** Provenance for `indexState: "excluded"` (see ExclusionReason). */
  excludedBy?: ExclusionReason;
  /**
   * Generic soft-delete marker (Cardspoke/memory objects): a trashed object
   * leaves every listing, search, index, and AI surface but stays recoverable
   * until explicitly purged. Files keep their own `file.deletedAt` lifecycle.
   */
  trashedAt?: number;
  /** The index state held before trashing, so restore puts it back — a
      deliberately excluded object must not come back indexable. */
  restoreIndexState?: IndexState;
  /** Set by Cardspoke Core conversions so a shape change is reversible. */
  previousType?: ObjectType;
  /**
   * Full snapshot of the sub-record the *last* conversion replaced (the
   * immediate previous shape), kept for display and single-step revert.
   */
  previousShape?: ConversionShape;
  /**
   * Per-type snapshots of every shape this object has previously held, keyed
   * by that shape's type. A single `previousShape` was overwritten on each
   * conversion, so task→card→document→task lost the original task's due date
   * and completion; this map preserves each type's last-known sub-record so a
   * multi-hop round trip is lossless.
   */
  previousShapes?: Partial<Record<ObjectType, ConversionShape>>;

  task?: TaskFields;
  file?: FileFields;
  card?: CardFields;
  project?: ProjectFields;
  memory?: MemoryFields;
}

/** Human labels + glyphs per object type, for consistent rendering across apps. */
export const OBJECT_TYPE_META: Record<
  ObjectType,
  { label: string; plural: string; glyph: string }
> = {
  document: { label: "Document", plural: "Documents", glyph: "≡" },
  card: { label: "Card", plural: "Cards", glyph: "▢" },
  task: { label: "Task", plural: "Tasks", glyph: "☑" },
  project: { label: "Project", plural: "Projects", glyph: "◈" },
  file: { label: "File", plural: "Files", glyph: "▚" },
  memory: { label: "Memory", plural: "Memory", glyph: "◌" },
};
