/*
 * Media Core — reusable media handling (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: images, audio, video, playback, recording, media metadata,
 * thumbnails, waveform/timeline primitives, and media permissions. Not a
 * media app — Photos, Music, Video, Viewer, and editors are surfaces over
 * it. Kind recognition, honest playback-support detection (a real
 * canPlayType probe, not "the Audio constructor exists"), metadata over the
 * shared file store, and the permission seam live here. Phase 1 (Files,
 * Media, And Real Local Bytes) wires byte-backed detection
 * (mediaMetaForStored) and real playback (mediaUrlFor, a Blob URL over
 * Files Core's byte store) — recording and a full playback service are
 * still future.
 *
 * AI uses this Core to inspect allowed media metadata (mediaMetaFor) — media
 * creation/editing routes through governed operations when those land.
 */

import { listFiles, hasStoredBytes, readFileBytes, readFileBytesHead } from "./files";
import { getSource } from "../sources";
import { redactText } from "./secrets";
import type { FileKind, SystemObject } from "@/types";

export type MediaKind = "image" | "audio" | "video" | "none";

const EXT_KINDS: Record<string, MediaKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  svg: "image", avif: "image", heic: "image", bmp: "image", ico: "image",
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", flac: "audio",
  m4a: "audio", aac: "audio", opus: "audio", wma: "audio",
  mp4: "video", webm: "video", mov: "video", mkv: "video", m4v: "video",
  avi: "video", ogv: "video",
};

/** MIME types per extension, for the canPlayType probe. */
const EXT_MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
  flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  opus: 'audio/ogg; codecs="opus"', wma: "audio/x-ms-wma",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mkv: "video/x-matroska", m4v: "video/mp4", avi: "video/x-msvideo",
  ogv: "video/ogg",
};

/** Image formats effectively every modern engine renders. SVG and AVIF are
    deliberately NOT here — SVG can be CSP-blocked and AVIF is not universally
    decodable, so claiming them "playable" would be less honest than the
    canPlayType path for audio/video. They report as not-guaranteed instead. */
const GUARANTEED_IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]);

/** The extension after the last dot, or "" when there is none. Query/hash tails
    are stripped first, so a ref like `song.mp3?token=abc` or `art.png#x`
    classifies by its real extension instead of "mp3?token=abc". */
function extOf(nameOrRef: string): string {
  const base = nameOrRef.split(/[?#]/)[0];
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx + 1).toLowerCase();
}

/** Recognize a media kind from a file name or reference. */
export function mediaKindFor(nameOrRef: string): MediaKind {
  return EXT_KINDS[extOf(nameOrRef)] ?? "none";
}

export function fileKindToMedia(kind: FileKind): MediaKind {
  if (kind === "image") return "image";
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "none";
}

/**
 * Can this browser actually play it? A real canPlayType probe against the
 * extension's MIME type — an .mkv or .flac is only "playable here" when the
 * engine says so, never by construction.
 */
const playbackProbeCache = new Map<string, boolean>();

/** Image MIME types effectively every modern engine renders (the byte-backed
    twin of GUARANTEED_IMAGES; SVG/AVIF stay deliberately not-guaranteed). */
const GUARANTEED_IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon",
]);

/** Can this browser play/render a (kind, MIME) pair? A real canPlayType probe
    for audio/video, probed once and cached per pair. */
export function supportsMime(kind: MediaKind, mime: string): boolean {
  if (kind === "none") return false;
  if (kind === "image") return GUARANTEED_IMAGE_MIMES.has(mime);
  if (!mime || typeof document === "undefined") return false;
  const cacheKey = `${kind}:${mime}`;
  const cached = playbackProbeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const probe =
    kind === "audio" ? document.createElement("audio") : document.createElement("video");
  const result = !!probe.canPlayType && probe.canPlayType(mime) !== "";
  playbackProbeCache.set(cacheKey, result);
  return result;
}

export function supportsPlayback(nameOrRef: string): boolean {
  const ext = extOf(nameOrRef);
  const kind = EXT_KINDS[ext] ?? "none";
  if (kind === "none") return false;
  if (kind === "image") return GUARANTEED_IMAGES.has(ext);
  const mime = EXT_MIME[ext];
  if (!mime) return false;
  return supportsMime(kind, mime);
}

export function describeMedia(nameOrRef: string): string {
  const kind = mediaKindFor(nameOrRef);
  if (kind === "none") return "Not a recognized media file";
  return `${kind[0].toUpperCase()}${kind.slice(1)} — ${
    supportsPlayback(nameOrRef)
      ? "playable in this browser"
      : "this browser cannot play the format"
  }`;
}

/** Thumbnail generation placeholder — real thumbnails need file bytes
    (OPFS / File System Access), which the browser phase does not hold yet. */
export function thumbnailFor(nameOrRef: string): string | null {
  void nameOrRef;
  return null;
}

/* -------------------------- byte-backed detection ---------------------------- */

/**
 * Content-based media detection (Wave 3): when actual BYTES exist, the
 * container's magic numbers — not the file extension — decide what the file
 * is. This is the seam a byte store (OPFS / File System Access) plugs into:
 * an extension is a claim, bytes are evidence, and evidence wins. Returns
 * null for unrecognized content (which callers must treat as "not media",
 * never fall back to trusting the extension for byte-backed files).
 */
export function detectMediaFromBytes(
  input: Uint8Array | ArrayBuffer,
): { kind: MediaKind; mime: string } | null {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 12) return null;
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...b.subarray(start, start + len));

  // Images
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { kind: "image", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  if (ascii(0, 4) === "GIF8") return { kind: "image", mime: "image/gif" };
  if (b[0] === 0x42 && b[1] === 0x4d) return { kind: "image", mime: "image/bmp" };
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00)
    return { kind: "image", mime: "image/x-icon" };

  // RIFF containers: WebP (image), WAV (audio), AVI (video)
  if (ascii(0, 4) === "RIFF") {
    const tag = ascii(8, 4);
    if (tag === "WEBP") return { kind: "image", mime: "image/webp" };
    if (tag === "WAVE") return { kind: "audio", mime: "audio/wav" };
    if (tag === "AVI ") return { kind: "video", mime: "video/x-msvideo" };
    return null;
  }

  // ISO-BMFF (ftyp) containers: brand decides image/audio/video
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4).trim().toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis"))
      return { kind: "image", mime: "image/avif" };
    if (brand.startsWith("hei") || brand.startsWith("mif"))
      return { kind: "image", mime: "image/heic" };
    if (brand.startsWith("m4a")) return { kind: "audio", mime: "audio/mp4" };
    if (brand === "qt") return { kind: "video", mime: "video/quicktime" };
    return { kind: "video", mime: "video/mp4" };
  }

  // Audio
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))
    return { kind: "audio", mime: "audio/mpeg" };
  if (ascii(0, 4) === "OggS") return { kind: "audio", mime: "audio/ogg" };
  if (ascii(0, 4) === "fLaC") return { kind: "audio", mime: "audio/flac" };

  // EBML (WebM/Matroska)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return { kind: "video", mime: "video/webm" };

  return null;
}

/* ------------------------------ media metadata ------------------------------ */

export interface MediaMeta {
  objectId: string;
  title: string;
  kind: MediaKind;
  sizeBytes?: number;
  playable: boolean;
  description: string;
}

/** Media files in the shared store, as metadata records. Trash is already
    excluded by listFiles; files on a source whose reading the user disabled are
    withheld too, so this AI-inspectable list matches the same read boundary the
    other Cores enforce. */
export function listMediaFiles(): MediaMeta[] {
  return listFiles()
    .filter((o) => {
      const src = getSource(o.source);
      return !src || src.readable;
    })
    // Explicit lambda: .map(mediaMetaFor) would pass the array index into
    // the optional `bytes` parameter.
    .map((o) => mediaMetaFor(o))
    .filter((m): m is MediaMeta => m !== null);
}

/** Media metadata for one file object — the AI-inspectable shape, so the title
    is redaction-passed like every other AI-facing label. Detection precedence:
    BYTES (magic numbers) when supplied win outright — an extension is a
    claim, content is evidence; without bytes, the extension wins over a stale
    declared kind (it is what playback would actually face). */
export function mediaMetaFor(o: SystemObject, bytes?: Uint8Array | ArrayBuffer): MediaMeta | null {
  if (o.type !== "file") return null;
  const nameOrRef = o.file?.ref ?? o.title;
  if (bytes) {
    const detected = detectMediaFromBytes(bytes);
    // Byte-backed files are judged by their content ONLY: unrecognized
    // content is not media, whatever the extension claims.
    if (!detected) return null;
    return {
      objectId: o.id,
      title: redactText(o.title),
      kind: detected.kind,
      sizeBytes: o.file?.sizeBytes,
      playable: supportsMime(detected.kind, detected.mime),
      description: `${detected.kind[0].toUpperCase()}${detected.kind.slice(1)} (${detected.mime}, detected from content)`,
    };
  }
  const byExtension = mediaKindFor(nameOrRef);
  const byDeclared = o.file?.kind ? fileKindToMedia(o.file.kind) : "none";
  const kind = byExtension !== "none" ? byExtension : byDeclared;
  if (kind === "none") return null;
  const playable = byExtension !== "none" ? supportsPlayback(nameOrRef) : false;
  return {
    objectId: o.id,
    title: redactText(o.title),
    kind,
    sizeBytes: o.file?.sizeBytes,
    playable,
    description:
      byExtension !== "none"
        ? describeMedia(nameOrRef)
        : `${kind[0].toUpperCase()}${kind.slice(1)} — no recognizable extension to probe`,
  };
}

/** mediaMetaFor for a byte-backed file, reading only enough of the stored
    content (readFileBytesHead) to run content detection — bytes beat the
    extension, exactly like the explicit-bytes path of mediaMetaFor, without
    the caller having to fetch the bytes itself first. Falls back to the
    ordinary extension/declared-kind path for a metadata-only file. */
export async function mediaMetaForStored(o: SystemObject): Promise<MediaMeta | null> {
  if (o.type !== "file" || !hasStoredBytes(o)) return mediaMetaFor(o);
  const head = await readFileBytesHead(o.id);
  return head ? mediaMetaFor(o, head) : mediaMetaFor(o);
}

/* ------------------------------ playback (browser phase) --------------------- */

/**
 * Blob URL playback — the browser-phase seam this Core owns for turning
 * stored bytes into something an <img>/<audio>/<video> element can point at.
 * Reads the file's full bytes through Files Core, detects the MIME from
 * content, and wraps them in a same-origin Blob URL. Returns null when the
 * file has no stored bytes, its content is not recognized media, or
 * URL.createObjectURL is unavailable (non-browser test/SSR context) — this
 * is deliberately NOT a Core-portable API (Blob/URL are DOM-only), which is
 * why it lives behind an explicit function apps call, not a field on
 * MediaMeta. Callers MUST releaseMediaUrl() when done to avoid leaking the
 * URL's backing memory.
 */
export async function mediaUrlFor(objectId: string): Promise<{ url: string; mime: string } | null> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const bytes = await readFileBytes(objectId);
  if (!bytes) return null;
  const detected = detectMediaFromBytes(bytes);
  if (!detected) return null;
  // Blob requires a real-ArrayBuffer-backed view; readFileBytes's return type
  // is the general Uint8Array (ArrayBufferLike) alias, so copy through the
  // Uint8Array constructor rather than assume the buffer kind.
  const blob = new Blob([new Uint8Array(bytes)], { type: detected.mime });
  return { url: URL.createObjectURL(blob), mime: detected.mime };
}

/** Revoke a Blob URL minted by mediaUrlFor. Safe to call on any string; a
    non-Blob-URL or an already-revoked one is simply a no-op. */
export function releaseMediaUrl(url: string): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
}

/* ---------------------------- media permissions ----------------------------- */

export type MediaDevice = "camera" | "microphone" | "screen-capture";
export type MediaPermission = "granted" | "denied" | "prompt" | "unsupported";

/**
 * The permission seam for recording inputs, wrapping the real Permissions
 * API where the browser exposes it. Grants stay explicit, scoped, and
 * audited when a recording surface actually asks.
 */
export async function mediaPermissionState(device: MediaDevice): Promise<MediaPermission> {
  if (device === "screen-capture" || typeof navigator === "undefined" || !navigator.permissions) {
    // Screen capture has no queryable permission; it is prompted per use.
    return device === "screen-capture" ? "prompt" : "unsupported";
  }
  try {
    const status = await navigator.permissions.query({
      name: (device === "camera" ? "camera" : "microphone") as PermissionName,
    });
    return status.state as MediaPermission;
  } catch {
    return "unsupported";
  }
}
