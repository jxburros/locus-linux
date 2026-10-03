/*
 * Files — the surface over Files Core (the common file authority).
 * File objects are metadata records (name, kind, size, reference, summary,
 * tags, project, index state) — and, since Phase 1 (Files, Media, And Real
 * Local Bytes), some of them are byte-backed for real: "Import files…"
 * reads real bytes through importFileBytes, real sizes and a "bytes" badge
 * come straight from the Core, and Download reads them back out. Every
 * mutation goes through the Core: adding uses addFileEntry (metadata-only)
 * or importFileBytes (real bytes), ✕ is a soft trashFile (recoverable in
 * the Trash section below — trash keeps bytes, only Empty trash purges
 * them), renames are audited, and media entries get a real "playable here?"
 * verdict from Media Core. One-shot AI read grants approved in the broker
 * appear in the sidebar and now release bytes too, with an inline preview
 * for images/audio via Media Core's mediaUrlFor.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useObjects } from "@/core/hooks";
import {
  listFiles,
  trashedFiles,
  recentFiles,
  addFileEntry,
  importFileBytes,
  hasStoredBytes,
  readFileBytes,
  storedByteUsage,
  trashFile,
  restoreFile,
  requestEmptyTrash,
  emptyTrash,
  listFileGrants,
  subscribeFileGrants,
  openFileWithGrant,
  revokeFileGrant,
  isGrantUsable,
  type FileAccessGrant,
  type OpenedFileContent,
} from "@/core/cores/files";
import { mediaMetaFor, mediaUrlFor, releaseMediaUrl } from "@/core/cores/media";
import { formatDateTime } from "@/core/cores/time";
import { getObject } from "@/core/objects";
import type { FileKind, SystemObject } from "@/types";
import { Section, FutureNote, Toolbar } from "@/components/ui";
import "./files.css";

const GLYPH: Record<FileKind, string> = {
  folder: "▚",
  doc: "≡",
  audio: "◍",
  image: "◨",
  video: "▶",
  other: "▪",
};

const INDEX_LABEL: Record<string, string> = {
  indexed: "indexed",
  unindexed: "not indexed",
  excluded: "excluded",
  stale: "stale",
};

function fmtSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Files() {
  // Any object write refreshes the lists (Files Core reads the shared store).
  useObjects();
  useSyncExternalStore(subscribeFileGrants, listFileGrants);
  const files = listFiles();
  const trashed = trashedFiles();
  const recents = recentFiles(4);
  const grants = listFileGrants().slice(0, 5);
  const byteUsage = storedByteUsage();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FileKind>("doc");
  const [showTrash, setShowTrash] = useState(false);
  const [purgeToken, setPurgeToken] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [byteError, setByteError] = useState<string | null>(null);
  const [openedContent, setOpenedContent] = useState<OpenedFileContent | null>(null);
  const [previewUrl, setPreviewUrl] = useState<{ url: string; mime: string } | null>(null);

  // Blob URLs are DOM memory that must be revoked — release the previous
  // one whenever a new preview replaces it, or the component unmounts.
  useEffect(() => {
    if (!previewUrl) return;
    return () => releaseMediaUrl(previewUrl.url);
  }, [previewUrl]);

  const collections = useMemo(() => {
    const tags = new Set<string>();
    files.forEach((f) => f.tags.forEach((t) => tags.add(t)));
    return [...tags];
  }, [files]);

  function addFile() {
    const n = name.trim();
    if (!n) return;
    addFileEntry({ title: n, kind });
    setName("");
  }

  async function importFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    setByteError(null);
    try {
      for (const f of Array.from(fileList)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await importFileBytes({ name: f.name, bytes });
      }
    } catch (err) {
      // Failure honesty: a byte-store write that failed must not look like a
      // completed import.
      setByteError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function downloadFile(f: SystemObject) {
    const bytes = await readFileBytes(f.id);
    if (!bytes) return;
    const blob = new Blob([new Uint8Array(bytes)]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.title;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openGrant(g: FileAccessGrant) {
    const opened = await openFileWithGrant(g.id);
    setOpenedContent(opened);
    if (opened?.bytes && (opened.mime?.startsWith("image/") || opened.mime?.startsWith("audio/"))) {
      setPreviewUrl(await mediaUrlFor(g.fileId));
    } else {
      setPreviewUrl(null);
    }
  }

  return (
    <div className="files">
      <div className="files__main">
        <div className="files__add">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFile()}
            placeholder="Add a file entry (name)…"
            aria-label="File name"
          />
          <select
            className="field files__kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as FileKind)}
            aria-label="File kind"
          >
            {(["doc", "image", "audio", "video", "folder", "other"] as FileKind[]).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button className="btn btn--primary" onClick={addFile}>Add</button>
          <label className="btn btn--ghost files__import-btn" aria-disabled={importing}>
            {importing ? "Importing…" : "Import files…"}
            <input
              type="file"
              multiple
              className="sr-only"
              disabled={importing}
              onChange={(e) => {
                void importFiles(e.target.files);
                e.target.value = "";
              }}
              aria-label="Import files (real bytes)"
            />
          </label>
        </div>

        <Toolbar>
          <span className="mono faint">/ home · {files.length} items</span>
          {byteUsage.count > 0 && (
            <span className="mono faint">
              {" "}· {byteUsage.count} byte-backed · {fmtSize(byteUsage.totalBytes)}
            </span>
          )}
          {trashed.length > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              style={{ marginLeft: "auto" }}
              onClick={() => setShowTrash((v) => !v)}
            >
              {showTrash ? "Hide trash" : `Trash · ${trashed.length}`}
            </button>
          )}
        </Toolbar>

        {byteError && (
          <p className="mono files__byte-error" role="alert">
            Byte store error: {byteError}
          </p>
        )}

        <ul className="files__grid">
          {files.map((f: SystemObject) => {
            const media = mediaMetaFor(f);
            return (
              <li key={f.id}>
                <div className="files__entry panel">
                  <div className="files__entry-top">
                    <span className="files__glyph mono" aria-hidden>
                      {media ? GLYPH[media.kind as FileKind] ?? "▪" : GLYPH[f.file?.kind ?? "other"]}
                    </span>
                    <span className="row" style={{ gap: 4 }}>
                      {hasStoredBytes(f) && (
                        <button
                          className="files__del"
                          onClick={() => void downloadFile(f)}
                          aria-label={`Download ${f.title}`}
                          title="Download the stored bytes"
                        >
                          ⭳
                        </button>
                      )}
                      <button
                        className="files__del"
                        onClick={() => trashFile(f.id)}
                        aria-label={`Move ${f.title} to trash`}
                        title="Move to trash (recoverable)"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  <span className="files__name">{f.title}</span>
                  {media && <span className="faint files__summary">{media.description}</span>}
                  {!media && f.file?.summary && (
                    <span className="faint files__summary">{f.file.summary}</span>
                  )}
                  <span className="mono faint files__meta">
                    {fmtSize(f.file?.sizeBytes)} · {INDEX_LABEL[f.indexState]}
                    {hasStoredBytes(f) && <span className="mono files__bytes-badge"> · bytes</span>}
                  </span>
                  {f.projectIds[0] && (
                    <span className="chip files__project">
                      {getObject(f.projectIds[0])?.title ?? "project"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          {files.length === 0 && <li className="faint files__empty">No files. Add one above.</li>}
        </ul>

        {showTrash && trashed.length > 0 && (
          <Section
            title={`Trash · ${trashed.length}`}
            action={
              <button
                className={`btn btn--sm ${purgeToken ? "btn--primary" : "btn--ghost"}`}
                onClick={() => {
                  // Two-step Core contract: mint the confirmation token, then
                  // spend it — a stale first click cannot destroy anything.
                  if (!purgeToken) {
                    setPurgeToken(requestEmptyTrash().token);
                    return;
                  }
                  // Also purges stored bytes; a mid-purge byte-store failure
                  // leaves the affected entries safely in the trash.
                  emptyTrash(purgeToken).catch((err) =>
                    setByteError(err instanceof Error ? err.message : String(err)),
                  );
                  setPurgeToken(null);
                  setShowTrash(false);
                }}
                title="Permanent deletion requires this second confirming click (Core-level token)"
              >
                {purgeToken ? "Confirm empty trash" : "Empty trash…"}
              </button>
            }
          >
            <ul className="files__grid">
              {trashed.map((f) => (
                <li key={f.id}>
                  <div className="files__entry panel files__entry--trashed">
                    <div className="files__entry-top">
                      <span className="files__glyph mono" aria-hidden>
                        {GLYPH[f.file?.kind ?? "other"]}
                      </span>
                      <button className="btn btn--ghost btn--sm" onClick={() => restoreFile(f.id)}>
                        Restore
                      </button>
                    </div>
                    <span className="files__name">{f.title}</span>
                    {f.file?.deletedAt && (
                      <span className="mono faint files__meta">
                        trashed {formatDateTime(f.file.deletedAt)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="About this app">
          <FutureNote
            items={[
              "Folder import and the File System Access picker (native folders/drives)",
              "Folder summaries generated by the indexer on request",
              "AI-assisted organization you review before it runs",
            ]}
          />
        </Section>
      </div>

      <aside className="files__side">
        <Section title="Recent">
          <ul className="files__side-list">
            {recents.map((r) => (
              <li key={r.id}><span className="files__side-item">{r.title}</span></li>
            ))}
            {recents.length === 0 && <li className="faint">—</li>}
          </ul>
        </Section>
        <Section title="Collections">
          <ul className="files__side-list">
            {collections.map((c) => (
              <li key={c}><span className="files__side-item">#{c}</span></li>
            ))}
            {collections.length === 0 && <li className="faint">Tag files to group them.</li>}
          </ul>
        </Section>
        {grants.length > 0 && (
          <Section title="AI read grants">
            <ul className="files__side-list">
              {grants.map((g) => (
                <li key={g.id}>
                  <span className="files__side-item">
                    {g.fileTitle}
                    <span className="mono faint">
                      {" "}· {g.usedAt ? "used" : isGrantUsable(g) ? "unconsumed" : "expired"}
                    </span>
                  </span>
                  {isGrantUsable(g) && (
                    <span className="row" style={{ gap: 4 }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => void openGrant(g)}
                        title="Consume the one-shot grant and release the file's content"
                      >
                        Open
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => revokeFileGrant(g.id)}
                        title="Revoke the unconsumed grant — nothing is released"
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {openedContent && (
              <div className="files__opened">
                <p className="mono faint">{openedContent.meta}</p>
                {openedContent.bytes && (
                  <p className="mono faint">
                    {openedContent.bytes.byteLength} bytes released
                    {openedContent.mime ? ` · ${openedContent.mime}` : ""}
                  </p>
                )}
                {previewUrl?.mime.startsWith("image/") && (
                  <img className="files__preview" src={previewUrl.url} alt="Opened file preview" />
                )}
                {previewUrl?.mime.startsWith("audio/") && (
                  <audio className="files__preview-audio" controls src={previewUrl.url} />
                )}
              </div>
            )}
          </Section>
        )}
      </aside>
    </div>
  );
}
