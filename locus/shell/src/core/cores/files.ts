/*
 * Files Core — the common file authority (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: files, folders, file references, metadata, previews, recents,
 * trash/restore, source grants, and file change events. The concept is
 * user-granted file/source capability — not "localStorage rows": file
 * objects are metadata entries, and (Phase 1: Files, Media, And Real Local
 * Bytes) real bytes now live behind them in core/byteStore.ts (OPFS or
 * IndexedDB, chosen once at first use) — this Core is still the only thing
 * that touches that store, so the same contract keeps mapping to native
 * filesystems, cloud mounts, and app sandboxes without changing every app.
 *
 * Apps go through this Core — never deleteObject on a file: deletion is a
 * soft trash (deletedAt) with restore + a token-gated permanent purge, every
 * mutation emits a typed file.* event, and approved access requests mint real
 * one-shot grant records. Minting and consumption are separate steps: approval
 * mints a revocable, expiring grant; openFileWithGrant() consumes it at the
 * moment content is actually released — the byte runtime has now replaced
 * only that release step, exactly as promised: a byte-backed file's grant
 * releases the redacted metadata AND the bytes; a metadata-only file still
 * releases metadata alone. Minting and consumption stay separate steps.
 *
 * AI uses this Core to reason about granted scopes (sourceGrants), read
 * redaction-aware metadata (fileMetaForAI), and request brokered access to
 * file contents (requestFileAccess) — never to touch bytes directly.
 */

import {
  createObject,
  updateObject,
  objectsOfType,
  getObject,
  deleteObject,
  mintDestructiveToken,
  consumeDestructiveToken,
  subscribe as subscribeObjects,
} from "../objects";
import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { emit, on } from "../events";
import { registerExternalExecutor, type ExecutorOutcome } from "../broker";
import { proposeThroughCore } from "./ai";
import { getSources, getSource, type ConnectedSource } from "../sources";
import type { ActionProposal, FileKind, SystemObject } from "@/types";
import { redactText } from "./secrets";
import { putBytes, readBytes, readHead, removeBytes, type ByteBackendKind } from "../byteStore";
import { detectMediaFromBytes } from "./media";

/** The "bytes:" ref prefix marking a file object as byte-backed, and the
    byteStore id it points at (today always the file object's own id — kept
    as a real ref so the convention lives in one place and future backends
    can point elsewhere without an object-shape change). */
const BYTES_REF_PREFIX = "bytes:";

function byteIdFor(f: SystemObject): string | null {
  const ref = f.file?.ref;
  return ref?.startsWith(BYTES_REF_PREFIX) ? ref.slice(BYTES_REF_PREFIX.length) : null;
}

/** One entry in the fileBytes manifest (StoreKeys.fileBytes) — a small JSON
    index of what byteStore holds, kept in sync by importFileBytes/emptyTrash
    so storedByteUsage() never has to touch the byte store to answer. */
interface FileByteManifestEntry {
  size: number;
  mime?: string;
  backend: ByteBackendKind;
  storedAt: number;
}

function loadByteManifest(): Record<string, FileByteManifestEntry> {
  return storage.get<Record<string, FileByteManifestEntry>>(StoreKeys.fileBytes, {});
}

/** Legacy soft-delete marker from the pre-`deletedAt` build. Migrated to the
    dedicated `deletedAt` field once, at boot, by migrateLegacyTrash(). */
const TRASH_TAG = "trash";

/**
 * Trash state lives in the dedicated `file.deletedAt` field ONLY. It is no
 * longer inferred from a `trash` *tag* — a tag is a user label, and treating it
 * as lifecycle state let emptyTrash() permanently delete a file the user had
 * merely tagged "trash". Legacy tag-trashed files are migrated to `deletedAt`
 * once at boot (migrateLegacyTrash), after which the tag is just a tag.
 */
export function isTrashed(f: SystemObject): boolean {
  return !!f.file?.deletedAt;
}

/** Is this file's source one the user still permits reading? Files on a source
    with reading disabled are out of AI reach (grants and metadata alike). */
function isSourceReadable(f: SystemObject): boolean {
  const src = getSource(f.source);
  return !src || src.readable;
}

export function listFiles(): SystemObject[] {
  return objectsOfType("file").filter((f) => !isTrashed(f));
}

export function trashedFiles(): SystemObject[] {
  return objectsOfType("file", { includeTrashed: true }).filter(isTrashed);
}

export function recentFiles(limit = 8): SystemObject[] {
  return [...listFiles()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

/** Store-level reactivity for file lists (any object write re-renders). For
    typed change signals, subscribe to "file.*" on the event bus instead. */
export const onFileChange = subscribeObjects;

/** Typed file events — added/renamed/trashed/restored, with the file object
    as payload. This replaces treating the whole object store as the signal. */
export function onFileEvent(fn: (type: string, file: SystemObject) => void): () => void {
  return on("file.*", (e) => {
    if (e.payload) fn(e.type, e.payload as SystemObject);
  });
}

export interface AddFileInput {
  title: string;
  kind: FileKind;
  sizeBytes?: number;
  ref?: string;
  projectIds?: string[];
}

export function addFileEntry(input: AddFileInput): SystemObject {
  const file = createObject({
    type: "file",
    title: input.title,
    projectIds: input.projectIds,
    file: { kind: input.kind, sizeBytes: input.sizeBytes, ref: input.ref },
  });
  record({
    type: "file.added",
    summary: `Files Core: added “${file.title}” (${input.kind})`,
    skipEmit: true, // the typed bus event below carries the SystemObject
  });
  emit("file.added", file);
  return file;
}

export function renameFile(id: string, title: string): SystemObject | undefined {
  const prev = getObject(id);
  if (!prev || prev.type !== "file") return undefined;
  const next = updateObject(id, { title });
  if (next && prev.title !== title) {
    record({
      type: "file.renamed",
      summary: `Files Core: “${prev.title}” renamed to “${title}”`,
      skipEmit: true,
    });
    emit("file.renamed", next);
  }
  return next;
}

/** Soft delete: the entry moves to trash and stays recoverable. */
export function trashFile(id: string): void {
  const f = getObject(id);
  if (!f || f.type !== "file" || isTrashed(f)) return;
  const next = updateObject(
    id,
    {
      // Remember the pre-trash index state so restore can put it back — a
      // deliberately excluded file must not come back indexable.
      file: { ...f.file!, deletedAt: Date.now(), restoreIndexState: f.indexState },
      indexState: "excluded",
      excludedBy: "trash",
    },
    { silent: true },
  );
  record({
    type: "file.trashed",
    summary: `Files Core: “${f.title}” moved to trash (recoverable)`,
    skipEmit: true,
  });
  if (next) emit("file.trashed", next);
}

export function restoreFile(id: string): void {
  const f = getObject(id);
  if (!f || f.type !== "file" || !isTrashed(f)) return;
  const {
    deletedAt: _dropped,
    restoreIndexState,
    ...fileFields
  } = f.file ?? { kind: "other" as FileKind };
  const next = updateObject(
    id,
    {
      file: fileFields,
      tags: f.tags.filter((t) => t !== TRASH_TAG),
      // Excluded stays excluded; anything else re-indexes as stale.
      indexState: restoreIndexState === "excluded" ? "excluded" : "stale",
      excludedBy: restoreIndexState === "excluded" ? "user" : undefined,
    },
    { silent: true },
  );
  record({
    type: "file.restored",
    summary: `Files Core: “${f.title}” restored from trash`,
    skipEmit: true,
  });
  if (next) emit("file.restored", next);
}

/** Step 1 of emptying the trash: mint the Core-level confirmation token. */
export function requestEmptyTrash(): { token: string; count: number } {
  return { token: mintDestructiveToken("files.trash"), count: trashedFiles().length };
}

/**
 * Permanently delete everything in the trash — the one hard-delete path for
 * files, and it only reaches entries that are already soft-deleted. Requires
 * the confirmation token from requestEmptyTrash (one-shot, short-lived): a
 * caller cannot destroy data in one call, and a stale confirm dialog cannot
 * destroy files trashed after it was shown.
 *
 * Trash keeps bytes until this point (a trashed file stays fully restorable);
 * emptying it purges the byte store too — every removeBytes() is awaited
 * before any metadata object is deleted, so a byte-store failure mid-purge
 * leaves the affected entries safely in the trash (metadata intact) instead
 * of silently leaking orphaned bytes or half-deleting the record.
 */
export async function emptyTrash(token: string): Promise<number> {
  if (!consumeDestructiveToken("files.trash", token)) {
    record({
      type: "system.event",
      summary: "Files Core: empty-trash refused — missing or expired confirmation token",
    });
    return 0;
  }
  const trashed = trashedFiles();
  for (const f of trashed) {
    const byteId = byteIdFor(f);
    if (byteId) await removeBytes(byteId);
  }
  for (const f of trashed) deleteObject(f.id);
  if (trashed.length > 0) {
    if (trashed.some((f) => byteIdFor(f))) {
      await storage.update<Record<string, FileByteManifestEntry>>(
        StoreKeys.fileBytes,
        {},
        (manifest) => {
          const next = { ...manifest };
          for (const f of trashed) delete next[f.id];
          return next;
        },
      );
    }
    record({
      type: "system.event",
      summary: `Files Core: trash emptied (${trashed.length} file${trashed.length === 1 ? "" : "s"} permanently deleted)`,
      // A recovery manifest of what was destroyed — the closest thing to undo
      // for a genuine hard delete of metadata entries.
      detail: `Deleted: ${trashed.map((f) => `“${f.title}” (${f.id})`).join(", ").slice(0, 600)}`,
    });
  }
  return trashed.length;
}

/* ------------------------------- source grants ------------------------------ */

/**
 * The file scopes the user has actually granted: connected sources with
 * reading enabled. This — not raw paths — is what the AI reasons about when
 * it asks "what files am I allowed to see?"
 */
export function sourceGrants(): ConnectedSource[] {
  return getSources().filter((s) => s.readable);
}

/* ------------------------------- access grants ------------------------------ */

/**
 * A one-shot access grant minted when the user approves a file-access
 * request. Minting and consumption are SEPARATE steps: approval mints the
 * grant; the runtime read path (openFileWithGrant) consumes it at the moment
 * the content is actually released. Until then the grant is revocable — the
 * approval prompt's "revoke it in the grants list" is a real promise. Grants
 * expire unconsumed after GRANT_TTL_MS.
 */
export interface FileAccessGrant {
  id: string;
  fileId: string;
  fileTitle: string;
  purpose: string;
  grantedAt: number;
  /** Unconsumed grants expire — an approval is not an open-ended standing right. */
  expiresAt: number;
  /** Set when a reader consumes the one-shot grant. */
  usedAt?: number;
}

/** How long an approved-but-unconsumed grant stays valid. */
export const GRANT_TTL_MS = 15 * 60_000;

let grantCache: FileAccessGrant[] | null = null;

function loadGrants(): FileAccessGrant[] {
  if (grantCache === null) grantCache = storage.get<FileAccessGrant[]>(StoreKeys.fileGrants, []);
  return grantCache;
}
function saveGrants(next: FileAccessGrant[]): void {
  grantCache = next.slice(0, 50);
  storage.set(StoreKeys.fileGrants, grantCache);
}

export function listFileGrants(): FileAccessGrant[] {
  return loadGrants();
}

export function subscribeFileGrants(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.fileGrants, () => {
    grantCache = storage.get<FileAccessGrant[]>(StoreKeys.fileGrants, []);
    fn();
  });
}

/** Is the grant still spendable — unconsumed and unexpired? */
export function isGrantUsable(g: FileAccessGrant, now = Date.now()): boolean {
  return !g.usedAt && now <= g.expiresAt;
}

/**
 * Consume an unused grant for a file — the one-shot check a reader must pass
 * before it may release anything. Returns the consumed grant, or null if no
 * usable grant exists (nothing was authorized, so nothing should be released).
 */
export function consumeFileGrant(fileId: string): FileAccessGrant | null {
  const grant = loadGrants().find((g) => g.fileId === fileId && isGrantUsable(g));
  if (!grant) return null;
  return consumeGrantById(grant.id);
}

/**
 * Consume one specific grant by its id — the exact grant a reader was issued,
 * not merely the first unused grant for the file. Prevents a reader from
 * spending a *different* pending grant for the same file than the one it holds.
 * Expired grants refuse.
 */
export function consumeGrantById(grantId: string): FileAccessGrant | null {
  const grant = loadGrants().find((g) => g.id === grantId && isGrantUsable(g));
  if (!grant) return null;
  const consumed = { ...grant, usedAt: Date.now() };
  saveGrants(loadGrants().map((g) => (g.id === grant.id ? consumed : g)));
  record({
    type: "file.access.granted",
    summary: `Files Core: one-shot read grant consumed for “${grant.fileTitle}”`,
  });
  return consumed;
}

/** What openFileWithGrant releases: the redacted metadata always, and — for
    a byte-backed file — the bytes and their content-detected MIME. */
export interface OpenedFileContent {
  meta: string;
  bytes?: Uint8Array;
  mime?: string;
}

/**
 * THE runtime read path (Wave 3, now byte-backed): open a file's content
 * through a previously approved grant. Re-validates everything at open time
 * — the file may have been trashed, its source's reading disabled, or the
 * grant revoked/expired since approval — then consumes the exact grant and
 * releases the redaction-aware metadata plus, when the file carries stored
 * bytes, the bytes themselves and their content-detected MIME (the byte
 * runtime has now replaced only this release step, not the grant lifecycle:
 * minting still happens at approval, consumption still happens here).
 * Returns null when nothing may be released.
 */
export async function openFileWithGrant(grantId: string): Promise<OpenedFileContent | null> {
  const grant = loadGrants().find((g) => g.id === grantId);
  if (!grant || !isGrantUsable(grant)) return null;
  const f = getObject(grant.fileId);
  if (!f || f.type !== "file" || isTrashed(f) || !isSourceReadable(f)) {
    record({
      type: "file.access.requested",
      summary: `Files Core: grant ${grantId} refused at open time — the file is gone, trashed, or its source unreadable`,
    });
    return null;
  }
  const consumed = consumeGrantById(grantId);
  if (!consumed) return null;
  const meta = fileMetaForAI(f.id);
  if (meta === null) return null;
  const byteId = byteIdFor(f);
  if (!byteId) return { meta };
  const bytes = await readBytes(byteId);
  if (!bytes) return { meta };
  // Bytes are evidence: detect from the released content, not the stored
  // manifest's recorded MIME (which is a snapshot from import time).
  return { meta, bytes, mime: detectMediaFromBytes(bytes)?.mime };
}

/** Revoke an unused grant — the "revoke it in the grants list" the approval
    prompt promises. A consumed grant cannot be revoked (already spent). */
export function revokeFileGrant(grantId: string): boolean {
  const grant = loadGrants().find((g) => g.id === grantId && !g.usedAt);
  if (!grant) return false;
  saveGrants(loadGrants().filter((g) => g.id !== grantId));
  record({
    type: "file.access.requested",
    summary: `Files Core: read grant revoked for “${grant.fileTitle}”`,
  });
  return true;
}

/**
 * Brokered access: the AI (or an app acting for it) asks to open a file's
 * contents for a purpose. Nothing is read now — the request becomes an
 * ActionProposal; approval mints a one-shot FileAccessGrant (see
 * initFilesCore's executor), and the grant is audited.
 */
export async function requestFileAccess(
  id: string,
  purpose: string,
): Promise<ActionProposal | null> {
  const f = getObject(id);
  // Trashed files, and files on a source whose reading the user disabled, are
  // out of AI reach on every path (fileMetaForAI agrees).
  if (!f || f.type !== "file" || isTrashed(f) || !isSourceReadable(f)) return null;
  record({
    type: "file.access.requested",
    summary: `Files Core: access requested for “${f.title}”`,
    detail: `Purpose: ${purpose}`,
  });
  // Through AI Core (verified originCore), never straight to the Broker.
  return proposeThroughCore("files", {
    app: "files",
    actionType: "files.access",
    summary: `Read “${f.title}”`,
    detail: `Purpose: ${purpose}. Grants one read of this file's contents; metadata stays redaction-aware.`,
    effect: {
      kind: "external",
      externalSummary: `Brokered read of file “${f.title}”`,
      readOnly: true,
      targetId: f.id,
    },
  });
}

/* ------------------------------- byte-backed files ---------------------------- */

const TEXT_LIKE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "yml", "yaml", "log", "ini", "conf", "sh", "py",
]);

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

/** Fallback kind when the bytes are not recognized media — a coarse,
    extension-based guess, used only when content detection has nothing to say. */
function kindFromExtension(name: string): FileKind {
  return TEXT_LIKE_EXTENSIONS.has(extensionOf(name)) ? "doc" : "other";
}

const MEDIA_KIND_TO_FILE_KIND: Record<"image" | "audio" | "video", FileKind> = {
  image: "image",
  audio: "audio",
  video: "video",
};

export interface ImportFileBytesInput {
  name: string;
  bytes: Uint8Array;
  projectIds?: string[];
}

/**
 * Import real bytes as a new file object (Phase 1: Files, Media, And Real
 * Local Bytes). Content decides the kind: detectMediaFromBytes reads the
 * magic numbers first — bytes are evidence, a filename is only a claim —
 * and only when the content is not recognized media does the name's
 * extension fall back to a coarse doc/other guess.
 *
 * The object is created first (addFileEntry-style — createObject generates
 * its id), the bytes are written to the byte store keyed by that id, and the
 * object is patched with `file.ref: "bytes:<id>"` so hasStoredBytes/
 * readFileBytes/openFileWithGrant can find them. The fileBytes manifest
 * (StoreKeys.fileBytes) is updated in the same pass, and a single
 * "file.imported" event/audit row covers the whole import — not the
 * generic "file.added" a metadata-only entry gets, so the two stay
 * distinguishable in the log.
 */
export async function importFileBytes(input: ImportFileBytesInput): Promise<SystemObject> {
  const detected = detectMediaFromBytes(input.bytes);
  const kind: FileKind = detected
    ? MEDIA_KIND_TO_FILE_KIND[detected.kind as "image" | "audio" | "video"]
    : kindFromExtension(input.name);

  const file = createObject({
    type: "file",
    title: input.name,
    projectIds: input.projectIds,
    file: { kind, sizeBytes: input.bytes.byteLength },
  });

  const stored = await putBytes(file.id, input.bytes);
  const withBytes =
    updateObject(
      file.id,
      { file: { ...file.file!, ref: `${BYTES_REF_PREFIX}${file.id}` } },
      { silent: true },
    ) ?? file;

  await storage.update<Record<string, FileByteManifestEntry>>(
    StoreKeys.fileBytes,
    {},
    (manifest) => ({
      ...manifest,
      [file.id]: {
        size: stored.size,
        mime: detected?.mime,
        backend: stored.backend,
        storedAt: Date.now(),
      },
    }),
  );

  record({
    type: "file.imported",
    summary: `Files Core: imported “${withBytes.title}” (${kind}, ${stored.size} bytes via ${stored.backend})`,
    skipEmit: true, // the typed bus event below carries the SystemObject
  });
  emit("file.imported", withBytes);
  return withBytes;
}

/** Does this file object point at real stored bytes (vs. metadata-only)? */
export function hasStoredBytes(f: SystemObject): boolean {
  return byteIdFor(f) !== null;
}

/**
 * User-path byte read: validates the file exists, is not trashed, and its
 * source is readable, then returns its stored bytes (or null when it has
 * none, or the validation fails). Unlike openFileWithGrant this is not
 * grant-gated — Core APIs invoked directly by the user are not
 * permission-gated in this codebase (the AI path is what grants exist for).
 */
export async function readFileBytes(id: string): Promise<Uint8Array | null> {
  const f = getObject(id);
  if (!f || f.type !== "file" || isTrashed(f) || !isSourceReadable(f)) return null;
  const byteId = byteIdFor(f);
  return byteId ? readBytes(byteId) : null;
}

/** Just the first `maxBytes` of a file's stored content — Media Core's seam
    for content-based detection without pulling a whole file into memory
    (see media.ts's mediaMetaForStored). Same validation as readFileBytes. */
export async function readFileBytesHead(
  id: string,
  maxBytes?: number,
): Promise<Uint8Array | null> {
  const f = getObject(id);
  if (!f || f.type !== "file" || isTrashed(f) || !isSourceReadable(f)) return null;
  const byteId = byteIdFor(f);
  return byteId ? readHead(byteId, maxBytes) : null;
}

/** Rough count/size of everything the byte store holds, from the manifest
    (sync — no byte-store round trip) — the Files app's storage readout. */
export function storedByteUsage(): { count: number; totalBytes: number } {
  const entries = Object.values(loadByteManifest());
  return {
    count: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
  };
}

/**
 * One-time migration: files trashed by the pre-`deletedAt` build carried a
 * `trash` tag as their only lifecycle marker. Move that state into the
 * dedicated `deletedAt` field (and strip the tag) so a plain "trash" tag can no
 * longer be misread as trashed and hard-deleted by emptyTrash(). Runs once,
 * guarded by a persisted flag.
 */
function migrateLegacyTrash(): void {
  if (storage.get<boolean>(StoreKeys.filesTrashMigrated, false)) return;
  const now = Date.now();
  for (const f of objectsOfType("file", { includeTrashed: true })) {
    if (f.tags.includes(TRASH_TAG) && !f.file?.deletedAt) {
      updateObject(
        f.id,
        {
          file: { ...(f.file ?? { kind: "other" as FileKind }), deletedAt: now, restoreIndexState: f.indexState },
          tags: f.tags.filter((t) => t !== TRASH_TAG),
          indexState: "excluded",
        },
        { silent: true },
      );
    }
  }
  storage.set(StoreKeys.filesTrashMigrated, true);
}

let started = false;
export function initFilesCore(): void {
  if (started) return;
  started = true;
  migrateLegacyTrash();
  registerExternalExecutor("files.access", (proposal): ExecutorOutcome => {
    const fileId = proposal.effect.targetId;
    const f = fileId ? getObject(fileId) : undefined;
    // Re-validate at execution: the file may have been deleted, trashed, or had
    // its source's reading disabled between request and approval. A refusal is
    // a failed outcome, not a silent "executed".
    if (!f || f.type !== "file") {
      return { status: "failed", detail: "The file no longer exists — no grant minted." };
    }
    if (isTrashed(f)) {
      return { status: "failed", detail: "The file is in the trash — no grant minted." };
    }
    if (!isSourceReadable(f)) {
      return { status: "failed", detail: "The file's source is no longer readable — no grant minted." };
    }
    const grant: FileAccessGrant = {
      id: `grant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      fileId: f.id,
      fileTitle: f.title,
      purpose: proposal.detail ?? proposal.summary,
      grantedAt: Date.now(),
      expiresAt: Date.now() + GRANT_TTL_MS,
    };
    saveGrants([grant, ...loadGrants()]);
    record({
      type: "file.access.granted",
      summary: `Files Core: one-shot read grant minted for “${f.title}” (unconsumed — spent at open time)`,
    });
    // Approval MINTS; it does not consume. The grant is spent at the actual
    // open (openFileWithGrant) — until then it is revocable, and it expires
    // unconsumed after GRANT_TTL_MS.
    return {
      status: "succeeded",
      resultId: grant.id,
      detail: `One-shot read grant ${grant.id} minted — open the file to consume it (revocable until then).`,
    };
  });
}

/* ----------------------------------- AI ------------------------------------- */

/**
 * AI-readable metadata for a file — never the bytes, and always through the
 * Secrets Core redaction pass (directive: respect redaction rules).
 */
export function fileMetaForAI(id: string): string | null {
  const f = getObject(id);
  if (!f || f.type !== "file" || isTrashed(f) || !isSourceReadable(f)) return null;
  const size = f.file?.sizeBytes ? `${Math.round(f.file.sizeBytes / 1024)} KB` : "unknown size";
  return redactText(
    `${f.title} — ${f.file?.kind ?? "file"}, ${size}${f.file?.summary ? `. ${f.file.summary}` : ""}`,
  );
}
