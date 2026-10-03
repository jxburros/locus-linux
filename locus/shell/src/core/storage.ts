/*
 * Local-first persistence.
 * ---------------------------------------------------------------------------
 * A tiny typed key/value store over localStorage, namespaced and versioned.
 * It is deliberately thin: one place reads/writes the browser, so the whole
 * app can be moved to a different backend later by reimplementing this module
 * alone — no app touches `localStorage` directly.
 *
 * It also exposes a subscribe() so React hooks can react to writes, including
 * writes from other tabs (via the native `storage` event).
 *
 * Failure honesty: a corrupt value is preserved under a backup key (never
 * silently overwritten by the next write), and write failures (quota,
 * private mode) are reported through onStorageFailure so the shell can tell
 * the user instead of dropping data invisibly.
 *
 * Durability (stabilization Wave 2): every write is mirrored, write-behind,
 * into an IndexedDB record store with a monotonic per-key revision. At boot,
 * hydrateDurable() restores records localStorage lost (cleared, evicted, or a
 * quota-failed write from a previous session that only the mirror captured).
 * localStorage stays the synchronous source of truth for the session; the
 * mirror is the recovery layer and the quota overflow net.
 *
 * Concurrency: storage.update() is the transactional read-modify-write path.
 * It serializes across tabs with the Web Locks API (and through a per-key
 * queue within a tab, which is also the fallback where Web Locks do not
 * exist), so security-critical mutations — the Broker lifecycle above all —
 * cannot double-run or lose records to a stale-cache overwrite.
 */

const NAMESPACE = "locus";
const SCHEMA_VERSION = 1;
const CORRUPT_PREFIX = "corrupt";

/** Every persisted key lives under one of these. Keeps storage self-describing. */
export const StoreKeys = {
  schemaVersion: "schema.version",
  theme: "settings.theme",
  accent: "settings.accent",
  density: "settings.density",
  systemName: "settings.systemName",
  assistantName: "settings.assistantName",
  reducedMotion: "settings.reducedMotion",
  aiProvider: "settings.aiProvider",
  recentApps: "shell.recentApps",
  desktop: "desktop.state",
  desktopOnboarded: "desktop.onboarded",
  notifications: "notifications.items",
  todoItems: "todo.items",
  quickNote: "notes.quick",
  musicState: "music.state",
  auditLog: "audit.events",
  auditArchive: "audit.archive",
  permissionOverrides: "permissions.overrides",
  onboarded: "system.onboarded",
  objects: "objects.store",
  workspaces: "workspace.layouts",
  activeWorkspace: "workspace.active",
  sources: "sources.connected",
  proposals: "broker.proposals",
  trustedActions: "broker.trustedActions",
  credentials: "broker.credentials",
  // Core Services layer (Custom OS Core System Directive)
  timeEntries: "time.entries",
  timeFormat: "time.format",
  timeDispatchOutbox: "time.dispatchOutbox",
  monitorWatches: "monitor.watches",
  monitorEvents: "monitor.events",
  secretsItems: "secrets.items",
  secretsTrash: "secrets.trash",
  peopleContacts: "people.contacts",
  peopleLinks: "people.links",
  webApps: "web.apps",
  // Core API Focus List additions
  aiRouting: "ai.routing",
  // Phase 3 (First Real Model Runtime): the opt-in provider-adapter config.
  modelRuntime: "ai.modelRuntime",
  notificationPolicy: "notifications.policy",
  devArtifacts: "dev.artifacts",
  devRuns: "dev.runs",
  // Core completion pass
  savedFilters: "cardspoke.savedFilters",
  fileGrants: "files.grants",
  secretsVaultMeta: "secrets.vault",
  webPageContexts: "web.pageContexts",
  // Core review pass
  platformRouting: "platform.routing",
  stopwatch: "time.stopwatch",
  // Stabilization pass (2026-07-10 audit): one-time migration flags.
  filesTrashMigrated: "files.trashMigrated",
  // Phase 1 (Files, Media, And Real Local Bytes): a small JSON manifest of
  // which file ids have bytes in core/byteStore.ts, and how big/what backend
  // — the byte payloads themselves never live here (see byteStore.ts).
  fileBytes: "files.bytes.index",
} as const;

export type StoreKey = (typeof StoreKeys)[keyof typeof StoreKeys];

function fullKey(key: string): string {
  return `${NAMESPACE}:${key}`;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function notify(key: string): void {
  if (key !== "*") listeners.get(key)?.forEach((fn) => fn());
  listeners.get("*")?.forEach((fn) => fn());
}

/*
 * Snapshot cache: get() returns the same parsed reference until the raw
 * string actually changes. useSyncExternalStore requires this — a fresh
 * JSON.parse per getSnapshot() is a new reference every render and forces
 * a re-render loop for object-valued keys.
 */
const snapshots = new Map<string, { raw: string; value: unknown }>();

/*
 * Stable references for ABSENT keys. get(key, fallback) is called with a fresh
 * `fallback` literal (usually `[]`) at each call site; when the key has no
 * stored value, returning that literal hands useSyncExternalStore a NEW
 * reference every render and spins an infinite re-render loop. Caching the
 * first fallback seen per key means an absent key reads back the same
 * reference every time, exactly like the snapshot cache does for present keys.
 */
const fallbackCache = new Map<string, unknown>();

/*
 * Values that could not be persisted (quota, private mode). Reads fall back
 * to these so the session stays consistent in memory; onStorageFailure lets
 * the shell surface the problem to the user.
 */
const unpersisted = new Map<string, unknown>();

export interface StorageFailure {
  kind: "write-failed" | "corrupt-value";
  key: string;
  message: string;
}

type FailureListener = (failure: StorageFailure) => void;
const failureListeners = new Set<FailureListener>();

/** Register a handler for storage problems (quota, corruption). */
export function onStorageFailure(fn: FailureListener): () => void {
  failureListeners.add(fn);
  return () => failureListeners.delete(fn);
}

/** Return a per-key-stable reference for an absent/invalid value (see
    fallbackCache). The first fallback given for a key wins and is returned by
    identity thereafter, so repeated absent reads don't churn references. */
function stableFallback<T>(key: string, fallback: T): T {
  if (fallbackCache.has(key)) return fallbackCache.get(key) as T;
  fallbackCache.set(key, fallback);
  return fallback;
}

function reportFailure(failure: StorageFailure): void {
  console.error(`[locus:storage] ${failure.kind}`, failure.key, failure.message);
  failureListeners.forEach((fn) => {
    try {
      fn(failure);
    } catch (err) {
      console.warn("[locus:storage] failure listener threw", err);
    }
  });
}

/**
 * A value that fails to parse is moved aside under locus:corrupt:<key> —
 * preserved for recovery — instead of being silently treated as empty and
 * destroyed by the next write. One backup per key; the first (oldest) wins.
 */
function preserveCorrupt(key: string, raw: string, message: string): void {
  try {
    const backupKey = fullKey(`${CORRUPT_PREFIX}:${key}`);
    if (localStorage.getItem(backupKey) === null) {
      localStorage.setItem(backupKey, raw);
    }
  } catch {
    // Preservation is best-effort; the report below still fires.
  }
  reportFailure({ kind: "corrupt-value", key, message });
}

/* ------------------------- cross-tab locking (Wave 2) ------------------------ */

/*
 * The Web Locks API serializes critical sections across tabs; a per-key
 * promise queue serializes them within a tab (and is the whole story where
 * Web Locks are unavailable — jsdom, older engines — where there is no real
 * cross-tab concurrency to defend against anyway).
 */
const keyQueues = new Map<string, Promise<unknown>>();

type LocksApi = {
  request: (name: string, callback: () => Promise<unknown>) => Promise<unknown>;
};

function webLocks(): LocksApi | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: LocksApi }).locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

/** Run `fn` holding an exclusive cross-tab lock for `key`. */
export async function withKeyLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const locks = webLocks();
    if (locks) {
      return (await locks.request(`${NAMESPACE}:lock:${key}`, async () => fn())) as T;
    }
    return fn();
  };
  const prev = keyQueues.get(key) ?? Promise.resolve();
  const chained = prev.then(run, run);
  // The stored chain must never reject, or one failure poisons the queue.
  keyQueues.set(key, chained.catch(() => undefined));
  return chained;
}

/* ---------------------- IndexedDB durable mirror (Wave 2) -------------------- */

const IDB_NAME = "locus-durable";
const IDB_STORE = "records";

/** One durable record: the raw persisted string plus a monotonic revision.
    `memoryOnly` marks a value whose localStorage write FAILED — the mirror is
    then the only durable copy, and boot hydration restores it. */
interface DurableRecord {
  key: string;
  raw: string;
  rev: number;
  updatedAt: number;
  memoryOnly?: boolean;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDurable(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/*
 * Write-behind queue: keystroke-frequency writes coalesce per key, and each
 * flush reads the prior revision and writes the next inside one IndexedDB
 * transaction — the "transactional record with a monotonic revision" the
 * stabilization plan asks for, without putting an async hop on the hot path.
 */
const pendingMirror = new Map<string, { raw: string | null; memoryOnly: boolean }>();
let mirrorScheduled = false;
/** Resolves when the mirror queue is empty — lets boot/tests await durability. */
let mirrorIdle: Promise<void> = Promise.resolve();
let mirrorIdleResolve: (() => void) | null = null;

function scheduleMirrorFlush(): void {
  if (mirrorScheduled) return;
  mirrorScheduled = true;
  if (!mirrorIdleResolve) {
    mirrorIdle = new Promise((r) => (mirrorIdleResolve = r));
  }
  setTimeout(() => {
    mirrorScheduled = false;
    void flushMirror();
  }, 50);
}

async function flushMirror(): Promise<void> {
  const batch = new Map(pendingMirror);
  pendingMirror.clear();
  if (batch.size === 0) {
    mirrorIdleResolve?.();
    mirrorIdleResolve = null;
    return;
  }
  const db = await openDurable();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        for (const [key, entry] of batch) {
          if (entry.raw === null) {
            store.delete(key);
            continue;
          }
          const rawValue = entry.raw;
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            const prev = getReq.result as DurableRecord | undefined;
            store.put({
              key,
              raw: rawValue,
              rev: (prev?.rev ?? 0) + 1,
              updatedAt: Date.now(),
              memoryOnly: entry.memoryOnly || undefined,
            } satisfies DurableRecord);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  if (pendingMirror.size > 0) {
    scheduleMirrorFlush();
  } else {
    mirrorIdleResolve?.();
    mirrorIdleResolve = null;
  }
}

function mirrorWrite(key: string, raw: string, memoryOnly: boolean): void {
  pendingMirror.set(key, { raw, memoryOnly });
  scheduleMirrorFlush();
}

function mirrorRemove(key: string): void {
  pendingMirror.set(key, { raw: null, memoryOnly: false });
  scheduleMirrorFlush();
}

/** Await the durable mirror catching up (tests, pre-unload best effort). */
export function durableMirrorSettled(): Promise<void> {
  return mirrorIdle;
}

/** Read every durable record (recovery surfaces, tests). */
export async function readDurableRecords(): Promise<
  { key: string; rev: number; updatedAt: number; memoryOnly?: boolean }[]
> {
  const db = await openDurable();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as DurableRecord[]).map(({ key, rev, updatedAt, memoryOnly }) => ({
            key,
            rev,
            updatedAt,
            memoryOnly,
          })),
        );
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Boot-time reconciliation between localStorage and the durable mirror:
 *
 * - A record localStorage no longer holds (cleared, evicted) is restored.
 * - A record marked `memoryOnly` is a write that FAILED to land in a previous
 *   session — the mirror holds the newest value, so it is restored over the
 *   stale localStorage copy (space may have been freed since), or kept in the
 *   in-memory overlay if writing still fails.
 * - Keys present in localStorage but absent from the mirror are seeded into
 *   it, so the mirror converges to a full copy.
 *
 * Returns the keys that were recovered from the mirror, for boot reporting.
 */
export async function hydrateDurable(): Promise<string[]> {
  const db = await openDurable();
  if (!db) return [];
  const records = await new Promise<DurableRecord[]>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result as DurableRecord[]);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  const recovered: string[] = [];
  for (const record of records) {
    let current: string | null = null;
    try {
      current = localStorage.getItem(fullKey(record.key));
    } catch {
      continue;
    }
    const missing = current === null;
    const failedWrite = record.memoryOnly && current !== record.raw;
    if (!missing && !failedWrite) {
      if (record.memoryOnly) mirrorWrite(record.key, record.raw, false);
      continue;
    }
    try {
      localStorage.setItem(fullKey(record.key), record.raw);
      snapshots.delete(record.key);
      mirrorWrite(record.key, record.raw, false); // clears memoryOnly
    } catch {
      // Still cannot land it — keep it readable in memory for this session.
      try {
        unpersisted.set(record.key, JSON.parse(record.raw));
      } catch {
        continue;
      }
    }
    recovered.push(record.key);
    notify(record.key);
  }
  // Seed the mirror with anything it does not hold yet.
  const known = new Set(records.map((r) => r.key));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${NAMESPACE}:`)) continue;
      const bare = k.slice(NAMESPACE.length + 1);
      if (bare.startsWith(`${CORRUPT_PREFIX}:`) || known.has(bare)) continue;
      const raw = localStorage.getItem(k);
      if (raw !== null) mirrorWrite(bare, raw, false);
    }
  } catch {
    // Enumeration is best-effort.
  }
  return recovered;
}

export const storage = {
  /**
   * Read a value. `validate`, when supplied, is a cheap runtime guard on the
   * parsed shape (e.g. `Array.isArray`): valid JSON that is not valid *state*
   * (wrong type, missing fields) is treated exactly like a corrupt value —
   * preserved under the backup key, reported, and replaced by `fallback` — so
   * one malformed stored record can never throw a Core during boot.
   */
  get<T>(key: string, fallback: T, validate?: (value: unknown) => boolean): T {
    if (unpersisted.has(key)) return unpersisted.get(key) as T;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(fullKey(key));
    } catch {
      return stableFallback(key, fallback);
    }
    if (raw === null) return stableFallback(key, fallback);
    const cached = snapshots.get(key);
    if (cached && cached.raw === raw) return cached.value as T;
    try {
      const value = JSON.parse(raw) as T;
      if (validate && !validate(value)) {
        preserveCorrupt(key, raw, "stored value did not match the expected shape");
        return stableFallback(key, fallback);
      }
      snapshots.set(key, { raw, value });
      return value;
    } catch (err) {
      preserveCorrupt(key, raw, err instanceof Error ? err.message : String(err));
      return stableFallback(key, fallback);
    }
  },

  set<T>(key: string, value: T): void {
    const raw = JSON.stringify(value);
    try {
      localStorage.setItem(fullKey(key), raw);
      snapshots.set(key, { raw, value });
      unpersisted.delete(key);
      mirrorWrite(key, raw, false);
    } catch (err) {
      // Storage can throw when full or blocked (private mode). Keep the value
      // in memory so this session stays consistent, mirror it durably (the
      // mirror has its own quota, so the value survives a reload), and report
      // loudly — a silent drop here is invisible data loss.
      unpersisted.set(key, value);
      mirrorWrite(key, raw, true);
      reportFailure({
        kind: "write-failed",
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    // Notify either way: subscribers must see what the session believes.
    notify(key);
  },

  /**
   * Transactional read-modify-write (Wave 2): re-reads the freshest persisted
   * value and applies `mutate` while holding an exclusive cross-tab lock for
   * the key, so two tabs can neither double-apply a state transition nor
   * overwrite each other's records from a stale cache. Use this for every
   * security-critical or record-oriented mutation; plain set() remains for
   * settings-grade writes.
   */
  async update<T>(
    key: string,
    fallback: T,
    mutate: (current: T) => T,
    validate?: (value: unknown) => boolean,
  ): Promise<T> {
    return withKeyLock(key, () => {
      const next = mutate(storage.get<T>(key, fallback, validate));
      storage.set(key, next);
      return next;
    });
  },

  remove(key: string): void {
    localStorage.removeItem(fullKey(key));
    snapshots.delete(key);
    unpersisted.delete(key);
    mirrorRemove(key);
    notify(key);
  },

  /** Subscribe to changes for a key, or "*" for any key. Returns an unsubscribe. */
  subscribe(key: string, fn: Listener): () => void {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    return () => listeners.get(key)?.delete(fn);
  },

  /** Wipe every Locus key. Used by Settings > Storage ("Reset all data"). */
  clearAll(): void {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${NAMESPACE}:`)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    // An explicit user reset clears the durable mirror too — otherwise the
    // next boot would faithfully "recover" everything the user just deleted.
    toRemove.forEach((k) => mirrorRemove(k.slice(NAMESPACE.length + 1)));
    snapshots.clear();
    unpersisted.clear();
    // Every per-key subscriber gets told, and "*" subscribers exactly once.
    toRemove.forEach((k) => {
      const bare = k.slice(NAMESPACE.length + 1);
      listeners.get(bare)?.forEach((fn) => fn());
    });
    listeners.get("*")?.forEach((fn) => fn());
  },

  /** Rough byte estimate of Locus-owned data, for the Storage panel. */
  estimateBytes(): number {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${NAMESPACE}:`)) {
        total += k.length + (localStorage.getItem(k)?.length ?? 0);
      }
    }
    return total * 2; // UTF-16 code units
  },

  /**
   * Every Locus-owned key, parsed, as one portable object — the "take your
   * data and leave" promise made real. Values that fail to parse are included
   * raw so an export is never silently partial.
   *
   * Values that failed to persist (quota, private mode) live only in the
   * `unpersisted` map; they are overlaid onto the export so the recovery
   * download the failure notification tells the user to take actually contains
   * the newest unsaved changes. `memoryOnlyKeys` names them so a re-import (or
   * the user) can tell rescued-from-memory data from data that was on disk.
   */
  exportAll(): {
    exportedAt: string;
    schemaVersion: number;
    data: Record<string, unknown>;
    memoryOnlyKeys: string[];
  } {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${NAMESPACE}:`)) continue;
      const bare = k.slice(NAMESPACE.length + 1);
      const raw = localStorage.getItem(k);
      if (raw === null) continue;
      try {
        data[bare] = JSON.parse(raw);
      } catch {
        data[bare] = { __unparsed: raw };
      }
    }
    const memoryOnlyKeys: string[] = [];
    for (const [key, value] of unpersisted) {
      data[key] = value;
      memoryOnlyKeys.push(key);
    }
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: storage.get<number>(StoreKeys.schemaVersion, SCHEMA_VERSION),
      data,
      memoryOnlyKeys,
    };
  },
};

/**
 * Runs once at boot: recovers durable records localStorage lost, records the
 * schema version so future migrations have an anchor, and wires cross-tab
 * reactivity. Await it BEFORE Core initialization so Cores boot against the
 * recovered state, not the lossy one. Returns the recovered keys so the boot
 * layer can tell the user what came back.
 */
export async function initStorage(): Promise<string[]> {
  // Recover before anything reads: a key localStorage lost (or a write that
  // failed last session and lives only in the mirror) must be back in place
  // before seeding decides the store is "empty" and overwrites it.
  const recovered = await hydrateDurable();
  const existing = storage.get<number | null>(StoreKeys.schemaVersion, null);
  if (existing === null) {
    storage.set(StoreKeys.schemaVersion, SCHEMA_VERSION);
  }
  // Cross-tab reactivity: mirror native storage events onto our listeners.
  // The snapshot cache self-corrects (it compares raw strings on read).
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith(`${NAMESPACE}:`)) {
      const bare = e.key.slice(NAMESPACE.length + 1);
      // Another tab successfully persisted this key. Any value we were holding
      // in memory because our own write failed is now stale — drop it so reads
      // reflect the saved value instead of returning the failed one forever.
      if (e.newValue !== null) unpersisted.delete(bare);
      notify(bare);
    }
  });
  return recovered;
}
