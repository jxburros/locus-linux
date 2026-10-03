/*
 * Indexing.
 * ---------------------------------------------------------------------------
 * Reading is broad inside a connected scope, so the OS keeps a metadata index
 * over the objects it may read. This module is the abstraction: it can run on
 * demand or (conceptually) on a schedule, respects each source's `indexable`
 * switch and exclusion patterns, derives a short summary per object, marks
 * objects indexed, stamps the source's last-indexed time, and logs the pass.
 *
 * There is no external crawler in this build — the "connected source" for now
 * is the local object store — but the shape is exactly what a real indexer of
 * folders or services would implement.
 */

import { allObjects, updateObject, subscribe as subscribeObjects } from "./objects";
import { getSources, getSource, markIndexed } from "./sources";
import { record } from "./audit";
import { emit } from "./events";
import { claimLeadership } from "./scheduler";
import type { SystemObject } from "@/types";

/** A trashed file is one with a soft-delete marker — kept in sync with Files
    Core's canonical `file.deletedAt`, without importing Files (cycle-free). */
function isTrashedObject(o: SystemObject): boolean {
  return !!o.trashedAt || !!o.file?.deletedAt;
}

export interface IndexStatus {
  total: number;
  indexed: number;
  unindexed: number;
  excluded: number;
  stale: number;
  lastRun: number | null;
}

/** Compute a rough summary for an object, the way a real indexer would derive
 *  a metadata blurb. Kept deterministic and local. */
export function deriveSummary(obj: SystemObject): string {
  if (obj.body && obj.body.trim()) {
    const clean = obj.body.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim();
    return clean.slice(0, 140) + (clean.length > 140 ? "…" : "");
  }
  switch (obj.type) {
    case "task":
      return `${obj.task?.done ? "Completed" : "Open"} task${
        obj.task?.priority === "high" ? " · high priority" : ""
      }.`;
    case "file":
      return `${obj.file?.kind ?? "file"}${
        obj.file?.sizeBytes ? ` · ${Math.round(obj.file.sizeBytes / 1024)} KB` : ""
      }.`;
    case "project":
      return obj.project?.summary || "Project hub.";
    default:
      return `${obj.type} · ${obj.tags.length} tag${obj.tags.length === 1 ? "" : "s"}.`;
  }
}

/** Translate a `*` / `**` / `?` glob to an anchored, case-insensitive RegExp.
 *  `**` crosses path separators; `*` does not. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = escaped
    .replace(/\*\*/g, "\u0000") // placeholder for cross-segment
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i");
}

/**
 * Does any exclusion pattern match this object? The pattern and the candidate
 * are normalized the SAME way (previously the pattern was stripped of `/` and
 * `*` while the candidate kept them, so `docs/secret.txt` and a bare `*` both
 * failed). A bare `*`/`**` matches everything; a glob is matched as a glob; a
 * plain string is matched as a substring for convenience.
 */
function isExcluded(obj: SystemObject, patterns: string[]): boolean {
  const candidates = [obj.file?.ref ?? "", obj.title]
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (/^\*+$/.test(p)) return true; // bare * / ** — match everything
    const hasGlob = /[*?]/.test(p);
    const re = hasGlob ? globToRegExp(p) : null;
    return candidates.some((c) =>
      re ? re.test(c) || re.test(`/${c}`) : c.includes(p),
    );
  });
}

/**
 * Is this object currently excluded by its source's live exclusion patterns?
 * Used at query time so an exclusion the user just added takes effect
 * immediately, without waiting for a re-index pass to stamp `indexState`.
 */
export function isExcludedNow(obj: SystemObject): boolean {
  const source = getSource(obj.source);
  return !!source && isExcluded(obj, source.exclusions);
}

/**
 * Run an index pass. With no argument, indexes every indexable source; with a
 * source id, only that source. Returns how many objects were (re)indexed.
 */
export function runIndex(sourceId?: string): number {
  const sources = sourceId
    ? [getSource(sourceId)].filter(Boolean)
    : getSources();
  const now = Date.now();
  let count = 0;

  for (const source of sources) {
    if (!source) continue;
    if (!source.indexable) {
      record({
        type: "source.indexed",
        summary: `Index skipped for “${source.name}” (indexing disabled)`,
      });
      continue;
    }
    const objects = allObjects().filter((o) => o.source === source.id);
    let indexed = 0;
    for (const obj of objects) {
      // Never revive a trashed object — trash is a lifecycle state the owning
      // Core holds, not an index verdict this pass may overwrite.
      if (isTrashedObject(obj)) continue;
      if (isExcluded(obj, source.exclusions)) {
        updateObject(
          obj.id,
          { indexState: "excluded", excludedBy: "source-pattern" },
          { silent: true },
        );
        continue;
      }
      // Exclusion provenance decides what a full pass may touch: an exclusion
      // stamped by a SOURCE PATTERN that no longer matches is lifted (this
      // pass owns that state); a USER's explicit exclusion, trash, or an
      // exclusion with unknown provenance (pre-provenance data) stays
      // excluded — never silently re-indexed.
      if (obj.indexState === "excluded" && obj.excludedBy !== "source-pattern") continue;
      updateObject(
        obj.id,
        {
          indexState: "indexed",
          excludedBy: undefined,
          // Derived summaries are stored on file metadata only; other object
          // types carry their own body, so there is nowhere to put one yet.
          file: obj.file ? { ...obj.file, summary: deriveSummary(obj) } : obj.file,
        },
        { silent: true },
      );
      indexed += 1;
    }
    markIndexed(source.id, now);
    count += indexed;
    record({
      type: "source.indexed",
      summary: `Indexed “${source.name}” · ${indexed} object${indexed === 1 ? "" : "s"}`,
      detail: source.exclusions.length
        ? `Exclusions applied: ${source.exclusions.join(", ")}`
        : undefined,
    });
  }
  // The declared index.updated event fires on manual passes too, not only the
  // auto reindexer, so subscribers refresh either way.
  if (count > 0) emit("index.updated", { reindexed: count });
  return count;
}

export function indexStatus(): IndexStatus {
  const objects = allObjects();
  const lastRuns = getSources()
    .map((s) => s.lastIndexed)
    .filter((n): n is number => typeof n === "number");
  return {
    total: objects.length,
    indexed: objects.filter((o) => o.indexState === "indexed").length,
    unindexed: objects.filter((o) => o.indexState === "unindexed").length,
    excluded: objects.filter((o) => o.indexState === "excluded").length,
    stale: objects.filter((o) => o.indexState === "stale").length,
    lastRun: lastRuns.length ? Math.max(...lastRuns) : null,
  };
}

/**
 * Re-index only stale/unindexed objects — the small pass the auto-indexer
 * runs. Respects each source's indexable switch and exclusions.
 */
export function reindexStale(): number {
  const sources = new Map(getSources().map((s) => [s.id, s]));
  const touchedSources = new Set<string>();
  let count = 0;
  for (const obj of allObjects()) {
    if (obj.indexState !== "stale" && obj.indexState !== "unindexed") continue;
    if (isTrashedObject(obj)) continue; // never re-index a trashed object
    const source = sources.get(obj.source);
    if (!source?.indexable) continue;
    if (isExcluded(obj, source.exclusions)) {
      updateObject(
        obj.id,
        { indexState: "excluded", excludedBy: "source-pattern" },
        { silent: true },
      );
      continue;
    }
    updateObject(
      obj.id,
      {
        indexState: "indexed",
        excludedBy: undefined,
        file: obj.file ? { ...obj.file, summary: deriveSummary(obj) } : obj.file,
      },
      { silent: true },
    );
    touchedSources.add(source.id);
    count += 1;
  }
  // Stamp last-indexed on the sources this pass actually touched (the auto
  // reindexer used to leave the timestamp stale).
  if (count > 0) {
    const at = Date.now();
    for (const id of touchedSources) markIndexed(id, at);
    emit("index.updated", { reindexed: count });
  }
  return count;
}

let indexerStarted = false;
let debounceTimer: number | null = null;

/**
 * Boot the auto-indexer: edits mark objects stale; a debounced pass
 * re-derives their summaries instead of leaving them stale until someone
 * finds the manual reindex command.
 */
export function initIndexing(debounceMs = 4000): void {
  if (indexerStarted) return;
  indexerStarted = true;
  subscribeObjects(() => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      // Every open tab sees the same object change; the lease makes exactly
      // one of them run the pass instead of racing whole-array writes.
      if (claimLeadership("indexer")) reindexStale();
    }, debounceMs);
  });
}
