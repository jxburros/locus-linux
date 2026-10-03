/*
 * Byte store — the local file BYTES seam (locus-platform-portability).
 * ---------------------------------------------------------------------------
 * Files Core owns file *metadata* (see core/cores/files.ts). This module is
 * the one place raw file bytes touch the platform — the byte-store twin of
 * core/storage.ts's key/value seam. Nothing outside this file reads or
 * writes bytes directly.
 *
 * The backend is chosen ONCE, at first use, and cached for the life of the
 * session — there is no automatic per-call fallback, so a caller can trust
 * that "opfs"/"idb"/"memory" stays consistent within a run:
 *
 *   1. OPFS (navigator.storage.getDirectory) — one file per id under a
 *      "locus-bytes" directory in the Origin Private File System. The
 *      backend closest in shape to the Linux form (a daemon-owned file per
 *      id on disk).
 *   2. IndexedDB blobs (DB "locus-bytes", store "bytes") — every other
 *      modern engine without OPFS.
 *   3. An in-memory Map — last resort (older engines, some test runners).
 *      Honest about its limits: nothing survives a reload.
 *
 * Linux-form replacement (planned, see linuxIntegrationPlan.md): a
 * daemon-owned file store behind the same id-keyed async API — this module's
 * shape is already the message-shaped contract Core APIs must keep (ids and
 * small JSON descriptors cross the boundary; the Uint8Array payloads are the
 * one deliberate exception, exactly like a byte stream would be over IPC).
 *
 * Failure honesty: every operation throws a clear Error on a real backend
 * failure rather than swallowing it — callers (Files Core) surface the
 * failure instead of pretending bytes were stored when they were not.
 *
 * No React/DOM imports; `navigator` access is confined to this file.
 */

export type ByteBackendKind = "opfs" | "idb" | "memory";

export interface PutBytesResult {
  id: string;
  size: number;
  backend: ByteBackendKind;
}

const OPFS_DIR = "locus-bytes";
const IDB_NAME = "locus-bytes";
const IDB_STORE = "bytes";
const DEFAULT_HEAD_BYTES = 64;

/** One IndexedDB record. `bytes` is a fresh ArrayBuffer copy, never a view
    sharing memory with caller-owned data. */
interface IdbByteRecord {
  id: string;
  bytes: ArrayBuffer;
  size: number;
  storedAt: number;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** OPFS/File System Access rejections for a missing entry use this name. */
function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

/** A private copy of the bytes, backed by a fresh real ArrayBuffer — never
    hand back or store a view over a buffer the caller might mutate after the
    call returns, and never assume the input's buffer is a plain ArrayBuffer
    (vs. a SharedArrayBuffer) since the DOM/File System Access APIs this
    module writes into require the former. */
function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return copyBytes(bytes).buffer;
}

/* --------------------------------- OPFS -------------------------------- */

let opfsRoot: FileSystemDirectoryHandle | null = null;
let opfsDir: FileSystemDirectoryHandle | null = null;

async function opfsFileHandle(id: string, create: boolean): Promise<FileSystemFileHandle> {
  if (!opfsDir) throw new Error("byteStore: OPFS directory unavailable");
  return opfsDir.getFileHandle(id, { create });
}

/* ------------------------------ IndexedDB ------------------------------- */

let idbDbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (idbDbPromise) return idbDbPromise;
  idbDbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbDbPromise;
}

function idbPut(db: IDBDatabase, record: IdbByteRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("unknown IndexedDB error"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<IdbByteRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve((req.result as IdbByteRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("unknown IndexedDB error"));
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("unknown IndexedDB error"));
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("unknown IndexedDB error"));
  });
}

/* -------------------------- backend selection --------------------------- */

let backendPromise: Promise<ByteBackendKind> | null = null;

async function detectBackend(): Promise<ByteBackendKind> {
  if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
    try {
      opfsRoot = await navigator.storage.getDirectory();
      opfsDir = await opfsRoot.getDirectoryHandle(OPFS_DIR, { create: true });
      return "opfs";
    } catch {
      opfsRoot = null;
      opfsDir = null;
    }
  }
  const db = await openIdb();
  if (db) return "idb";
  return "memory";
}

function selectedBackend(): Promise<ByteBackendKind> {
  if (!backendPromise) backendPromise = detectBackend();
  return backendPromise;
}

/** Which backend this session is using — chosen once, at first use. */
export async function byteBackendKind(): Promise<ByteBackendKind> {
  return selectedBackend();
}

/* --------------------------------- memory -------------------------------- */

const memoryStore = new Map<string, { bytes: Uint8Array; storedAt: number }>();

/* ---------------------------------- API ---------------------------------- */

/** Store bytes under `id`, overwriting any previous content for that id. */
export async function putBytes(id: string, bytes: Uint8Array): Promise<PutBytesResult> {
  const backend = await selectedBackend();
  const size = bytes.byteLength;
  if (backend === "opfs") {
    try {
      const handle = await opfsFileHandle(id, true);
      const writable = await handle.createWritable();
      await writable.write(copyBytes(bytes));
      await writable.close();
    } catch (err) {
      throw new Error(`byteStore: OPFS write failed for "${id}": ${message(err)}`);
    }
  } else if (backend === "idb") {
    const db = await openIdb();
    if (!db) throw new Error(`byteStore: IndexedDB unavailable for put(${id})`);
    try {
      await idbPut(db, { id, bytes: toArrayBuffer(bytes), size, storedAt: Date.now() });
    } catch (err) {
      throw new Error(`byteStore: IndexedDB write failed for "${id}": ${message(err)}`);
    }
  } else {
    memoryStore.set(id, { bytes: copyBytes(bytes), storedAt: Date.now() });
  }
  return { id, size, backend };
}

/** Read every stored byte for `id`, or null if nothing is stored. */
export async function readBytes(id: string): Promise<Uint8Array | null> {
  const backend = await selectedBackend();
  if (backend === "opfs") {
    try {
      const handle = await opfsFileHandle(id, false);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new Error(`byteStore: OPFS read failed for "${id}": ${message(err)}`);
    }
  }
  if (backend === "idb") {
    const db = await openIdb();
    if (!db) throw new Error(`byteStore: IndexedDB unavailable for read(${id})`);
    try {
      const record = await idbGet(db, id);
      return record ? new Uint8Array(record.bytes) : null;
    } catch (err) {
      throw new Error(`byteStore: IndexedDB read failed for "${id}": ${message(err)}`);
    }
  }
  const entry = memoryStore.get(id);
  return entry ? entry.bytes.slice() : null;
}

/** Read only the first `maxBytes` (default 64) — enough for magic-number
    detection without pulling a whole file into memory. */
export async function readHead(
  id: string,
  maxBytes: number = DEFAULT_HEAD_BYTES,
): Promise<Uint8Array | null> {
  const backend = await selectedBackend();
  if (backend === "opfs") {
    try {
      const handle = await opfsFileHandle(id, false);
      const file = await handle.getFile();
      return new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new Error(`byteStore: OPFS head-read failed for "${id}": ${message(err)}`);
    }
  }
  if (backend === "idb") {
    const db = await openIdb();
    if (!db) throw new Error(`byteStore: IndexedDB unavailable for readHead(${id})`);
    try {
      const record = await idbGet(db, id);
      return record ? new Uint8Array(record.bytes.slice(0, maxBytes)) : null;
    } catch (err) {
      throw new Error(`byteStore: IndexedDB head-read failed for "${id}": ${message(err)}`);
    }
  }
  const entry = memoryStore.get(id);
  return entry ? entry.bytes.slice(0, maxBytes) : null;
}

/** Remove the stored bytes for `id`. Returns whether anything was removed. */
export async function removeBytes(id: string): Promise<boolean> {
  const backend = await selectedBackend();
  if (backend === "opfs") {
    try {
      await opfsFileHandle(id, false);
    } catch (err) {
      if (isNotFound(err)) return false;
      throw new Error(`byteStore: OPFS remove failed for "${id}": ${message(err)}`);
    }
    try {
      await opfsDir!.removeEntry(id);
      return true;
    } catch (err) {
      throw new Error(`byteStore: OPFS remove failed for "${id}": ${message(err)}`);
    }
  }
  if (backend === "idb") {
    const db = await openIdb();
    if (!db) throw new Error(`byteStore: IndexedDB unavailable for remove(${id})`);
    try {
      const existing = await idbGet(db, id);
      if (!existing) return false;
      await idbDelete(db, id);
      return true;
    } catch (err) {
      throw new Error(`byteStore: IndexedDB remove failed for "${id}": ${message(err)}`);
    }
  }
  return memoryStore.delete(id);
}

/** Wipe every stored byte entry. On OPFS this drops the whole "locus-bytes"
    directory recursively (then recreates it empty), so entries written by
    earlier sessions are swept too. Used by full-reset flows. */
export async function clearAllBytes(): Promise<void> {
  const backend = await selectedBackend();
  if (backend === "opfs") {
    try {
      if (!opfsRoot) throw new Error("OPFS root unavailable");
      await opfsRoot.removeEntry(OPFS_DIR, { recursive: true }).catch((err) => {
        if (!isNotFound(err)) throw err;
      });
      opfsDir = await opfsRoot.getDirectoryHandle(OPFS_DIR, { create: true });
    } catch (err) {
      throw new Error(`byteStore: OPFS clear failed: ${message(err)}`);
    }
    return;
  }
  if (backend === "idb") {
    const db = await openIdb();
    if (!db) throw new Error("byteStore: IndexedDB unavailable for clearAllBytes()");
    try {
      await idbClear(db);
    } catch (err) {
      throw new Error(`byteStore: IndexedDB clear failed: ${message(err)}`);
    }
    return;
  }
  memoryStore.clear();
}
