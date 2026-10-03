/*
 * Connected sources & scopes.
 * ---------------------------------------------------------------------------
 * A "source" is a place Locus may read and index — the built-in local store,
 * or later a connected folder, mailbox, or service. The product model is
 * "reading is broad inside a connected scope, action stays gated", so a source
 * carries two switches: `readable` (may the AI see it at all) and `indexable`
 * (may the indexer build summaries over it), plus a list of excluded paths.
 *
 * In this PWA build there is no native filesystem, so connected sources are
 * modelled honestly: the local object store is a real source, and additional
 * sources are declared placeholders with the same scope controls, ready to be
 * backed by the File System Access API or a service connector later.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";

export type SourceKind = "local" | "folder" | "service" | "device";

export interface ConnectedSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** May the AI read anything from this source. */
  readable: boolean;
  /** May the indexer build metadata summaries over this source. */
  indexable: boolean;
  /** Path/pattern exclusions kept out of the index even when indexable. */
  exclusions: string[];
  /** Epoch ms of the last successful index pass, or null if never. */
  lastIndexed: number | null;
  /** Whether this is a built-in source that cannot be removed. */
  builtIn?: boolean;
  /** One-line description shown in the UI. */
  detail?: string;
}

// Stable-reference cache for useSyncExternalStore (see workspace.ts).
let cache: ConnectedSource[] | null = null;

function load(): ConnectedSource[] {
  if (cache) return cache;
  cache = storage.get<ConnectedSource[]>(StoreKeys.sources, []);
  return cache;
}

function save(list: ConnectedSource[]): void {
  cache = list;
  storage.set(StoreKeys.sources, list);
}

export function getSources(): ConnectedSource[] {
  return load();
}

export function getSource(id: string): ConnectedSource | undefined {
  return load().find((s) => s.id === id);
}

function mutate(id: string, fn: (s: ConnectedSource) => ConnectedSource): void {
  save(load().map((s) => (s.id === id ? fn(s) : s)));
}

export function setReadable(id: string, readable: boolean): void {
  const s = getSource(id);
  if (!s) return;
  mutate(id, (x) => ({ ...x, readable }));
  record({
    type: "permission.changed",
    summary: `Source “${s.name}” ${readable ? "made readable" : "reading disabled"}`,
  });
}

export function setIndexable(id: string, indexable: boolean): void {
  const s = getSource(id);
  if (!s) return;
  mutate(id, (x) => ({ ...x, indexable }));
  record({
    type: "permission.changed",
    summary: `Source “${s.name}” indexing ${indexable ? "enabled" : "disabled"}`,
  });
}

export function addExclusion(id: string, pattern: string): void {
  const p = pattern.trim();
  if (!p) return;
  mutate(id, (x) =>
    x.exclusions.includes(p) ? x : { ...x, exclusions: [...x.exclusions, p] },
  );
  record({ type: "permission.changed", summary: `Exclusion added to source: ${p}` });
}

export function removeExclusion(id: string, pattern: string): void {
  const s = getSource(id);
  if (!s || !s.exclusions.includes(pattern)) return;
  mutate(id, (x) => ({ ...x, exclusions: x.exclusions.filter((e) => e !== pattern) }));
  // Scope *widening* — previously excluded content becomes indexable again.
  // The more security-relevant direction must not be the silent one.
  record({ type: "permission.changed", summary: `Exclusion removed from source: ${pattern}` });
}

export function markIndexed(id: string, at: number): void {
  mutate(id, (x) => ({ ...x, lastIndexed: at }));
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.sources, () => {
    cache = null;
    fn();
  });
}

/** Seed the built-in local source plus a couple of connected-source placeholders. */
export function seedIfEmpty(): void {
  if (load().length > 0) return;
  const now = Date.now();
  save([
    {
      id: "local",
      name: "This device",
      kind: "local",
      readable: true,
      indexable: true,
      exclusions: [],
      lastIndexed: now - 1000 * 60 * 8,
      builtIn: true,
      detail: "Documents, cards, tasks, projects, files, and memory stored locally.",
    },
    {
      id: "folder-workspace",
      name: "Workspace folder",
      kind: "folder",
      readable: true,
      indexable: false,
      exclusions: ["**/node_modules/**", "**/.git/**"],
      lastIndexed: null,
      detail: "A local folder connected via the File System Access API (placeholder).",
    },
    {
      id: "service-mail",
      name: "Mail",
      kind: "service",
      readable: false,
      indexable: false,
      exclusions: [],
      lastIndexed: null,
      detail: "A connected mailbox, brokered and scoped (placeholder).",
    },
  ]);
}
