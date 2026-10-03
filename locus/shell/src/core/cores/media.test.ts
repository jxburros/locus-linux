import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as MediaModule from "./media";
import type * as FilesModule from "./files";

let Media: typeof MediaModule;
let Files: typeof FilesModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Media = await import("./media");
  Files = await import("./files");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mediaKindFor", () => {
  it("recognizes image/audio/video extensions case-insensitively", () => {
    expect(Media.mediaKindFor("photo.PNG")).toBe("image");
    expect(Media.mediaKindFor("song.mp3")).toBe("audio");
    expect(Media.mediaKindFor("clip.mp4")).toBe("video");
  });

  it("returns none for an unrecognized extension", () => {
    expect(Media.mediaKindFor("notes.txt")).toBe("none");
  });

  it("does not mistake a bare name with no dot for its own extension", () => {
    // A title that happens to equal a known extension word, with no dot,
    // must not be treated as if it were a file named "x.png".
    expect(Media.mediaKindFor("png")).toBe("none");
    expect(Media.mediaKindFor("mp4")).toBe("none");
  });

  it("handles a trailing dot with no extension as none", () => {
    expect(Media.mediaKindFor("file.")).toBe("none");
  });
});

describe("fileKindToMedia", () => {
  it("maps declared FileKind to MediaKind", () => {
    expect(Media.fileKindToMedia("image")).toBe("image");
    expect(Media.fileKindToMedia("audio")).toBe("audio");
    expect(Media.fileKindToMedia("video")).toBe("video");
    expect(Media.fileKindToMedia("doc")).toBe("none");
    expect(Media.fileKindToMedia("folder")).toBe("none");
  });
});

describe("supportsPlayback", () => {
  it("treats universally-renderable image formats as playable", () => {
    expect(Media.supportsPlayback("photo.png")).toBe(true);
    expect(Media.supportsPlayback("photo.jpg")).toBe(true);
  });

  it("does not claim playback support for a non-media extension", () => {
    expect(Media.supportsPlayback("notes.txt")).toBe(false);
  });

  it("probes audio/video via canPlayType rather than assuming support", () => {
    // jsdom's canPlayType always reports "" (no format supported) — this is
    // actually the honest answer for a real headless/non-media environment,
    // which is exactly the behavior supportsPlayback is designed to reflect.
    expect(Media.supportsPlayback("song.mp3")).toBe(false);
    expect(Media.supportsPlayback("clip.mp4")).toBe(false);
  });
});

describe("describeMedia", () => {
  it("describes an unrecognized file as not a recognized media file", () => {
    expect(Media.describeMedia("notes.txt")).toBe("Not a recognized media file");
  });

  it("describes a recognized kind with its playability", () => {
    expect(Media.describeMedia("photo.png")).toBe("Image — playable in this browser");
    expect(Media.describeMedia("song.mp3")).toBe("Audio — this browser cannot play the format");
  });
});

describe("thumbnailFor", () => {
  it("is a placeholder that always returns null", () => {
    expect(Media.thumbnailFor("photo.png")).toBeNull();
  });
});

describe("mediaMetaFor / listMediaFiles", () => {
  it("returns null for a non-file object", async () => {
    const Objects = await import("../objects");
    const card = Objects.createObject({ type: "card", title: "Card" });
    expect(Media.mediaMetaFor(card)).toBeNull();
  });

  it("recognizes media by extension in the file's ref", () => {
    const f = Files.addFileEntry({ title: "Vacation", kind: "doc", ref: "vacation.jpg" });
    const meta = Media.mediaMetaFor(Files.listFiles()[0]);
    expect(meta?.kind).toBe("image");
    void f;
  });

  it("falls back to the declared FileKind when the extension is unrecognized", () => {
    const f = Files.addFileEntry({ title: "Recording", kind: "audio", ref: "recording-blob" });
    const meta = Media.mediaMetaFor(Files.listFiles()[0]);
    expect(meta?.kind).toBe("audio");
    expect(meta?.playable).toBe(false); // no extension to probe
    expect(meta?.description).toContain("no recognizable extension to probe");
    void f;
  });

  it("lets the extension override a disagreeing declared kind", () => {
    // Declared as "doc" but the ref is unmistakably an image — extension wins.
    const f = Files.addFileEntry({ title: "Mislabeled", kind: "doc", ref: "photo.png" });
    const meta = Media.mediaMetaFor(Files.listFiles()[0]);
    expect(meta?.kind).toBe("image");
    void f;
  });

  it("returns null for a file with neither a recognizable extension nor a media FileKind", () => {
    const f = Files.addFileEntry({ title: "Report", kind: "doc" });
    expect(Media.mediaMetaFor(Files.listFiles()[0])).toBeNull();
    void f;
  });

  it("listMediaFiles excludes trashed files (via listFiles) and non-media files", () => {
    const media = Files.addFileEntry({ title: "Song", kind: "audio", ref: "song.mp3" });
    const trashedMedia = Files.addFileEntry({ title: "Old song", kind: "audio", ref: "old.mp3" });
    Files.addFileEntry({ title: "Report", kind: "doc" }); // not media
    Files.trashFile(trashedMedia.id);

    const list = Media.listMediaFiles();
    expect(list.map((m) => m.objectId)).toEqual([media.id]);
  });
});

describe("mediaPermissionState", () => {
  it("reports 'prompt' for screen-capture regardless of the Permissions API", () => {
    return Media.mediaPermissionState("screen-capture").then((state) => {
      expect(state).toBe("prompt");
    });
  });

  it("reports 'unsupported' for camera/microphone when the Permissions API is unavailable", async () => {
    expect(await Media.mediaPermissionState("camera")).toBe("unsupported");
    expect(await Media.mediaPermissionState("microphone")).toBe("unsupported");
  });

  it("queries the real Permissions API when available", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn().mockResolvedValue({ state: "granted" }) },
    });
    expect(await Media.mediaPermissionState("camera")).toBe("granted");
  });

  it("falls back to 'unsupported' when the Permissions API throws", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn().mockRejectedValue(new Error("nope")) },
    });
    expect(await Media.mediaPermissionState("microphone")).toBe("unsupported");
  });
});

describe("byte-backed detection (Wave 3)", () => {
  const bytes = (...head: number[]) => {
    const arr = new Uint8Array(16);
    arr.set(head);
    return arr;
  };
  const asciiBytes = (s: string, at = 0, len = 16) => {
    const arr = new Uint8Array(len);
    for (let i = 0; i < s.length; i++) arr[at + i] = s.charCodeAt(i);
    return arr;
  };

  it("detects kinds from magic numbers", () => {
    expect(Media.detectMediaFromBytes(bytes(0x89, 0x50, 0x4e, 0x47))).toEqual({
      kind: "image",
      mime: "image/png",
    });
    expect(Media.detectMediaFromBytes(bytes(0xff, 0xd8, 0xff))?.mime).toBe("image/jpeg");
    expect(Media.detectMediaFromBytes(asciiBytes("OggS"))?.kind).toBe("audio");
    expect(Media.detectMediaFromBytes(asciiBytes("fLaC"))?.mime).toBe("audio/flac");
    expect(Media.detectMediaFromBytes(bytes(0x1a, 0x45, 0xdf, 0xa3))?.mime).toBe("video/webm");
    const wav = asciiBytes("RIFF");
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(Media.detectMediaFromBytes(wav)?.mime).toBe("audio/wav");
    const mp4 = new Uint8Array(16);
    mp4.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
    mp4.set([0x69, 0x73, 0x6f, 0x6d], 8); // "isom"
    expect(Media.detectMediaFromBytes(mp4)?.mime).toBe("video/mp4");
    expect(Media.detectMediaFromBytes(asciiBytes("not media at all"))).toBeNull();
  });

  it("bytes beat the extension in mediaMetaFor — content is evidence, names are claims", async () => {
    const Objects = await import("../objects");
    // A file NAMED like an mp3, whose bytes are actually a PNG.
    const f = Objects.createObject({
      type: "file",
      title: "song.mp3",
      file: { kind: "audio", ref: "/x/song.mp3" },
    });
    const png = bytes(0x89, 0x50, 0x4e, 0x47);
    const meta = Media.mediaMetaFor(Objects.getObject(f.id)!, png);
    expect(meta?.kind).toBe("image");
    expect(meta?.description).toContain("image/png");
    // Unrecognized bytes are NOT media, whatever the extension claims.
    expect(Media.mediaMetaFor(Objects.getObject(f.id)!, asciiBytes("garbage bytes!"))).toBeNull();
    // Without bytes, the extension path still works as before.
    expect(Media.mediaMetaFor(Objects.getObject(f.id)!)?.kind).toBe("audio");
  });
});

describe("mediaMetaForStored (Phase 1: Files, Media, And Real Local Bytes)", () => {
  const png = new Uint8Array(20);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("detects from stored bytes, beating a mismatched title/declared kind", async () => {
    const ByteStore = await import("../byteStore");
    const Objects = await import("../objects");
    // Declared as audio, named like an mp3 — but the stored bytes are a PNG.
    const f = Objects.createObject({
      type: "file",
      title: "song.mp3",
      file: { kind: "audio", ref: "placeholder" },
    });
    Objects.updateObject(f.id, { file: { ...f.file!, ref: `bytes:${f.id}` } }, { silent: true });
    await ByteStore.putBytes(f.id, png);

    const meta = await Media.mediaMetaForStored(Objects.getObject(f.id)!);
    expect(meta?.kind).toBe("image");
    expect(meta?.description).toContain("image/png");
  });

  it("falls back to the ordinary extension/declared-kind path for a metadata-only file", async () => {
    const f = Files.addFileEntry({ title: "Vacation", kind: "doc", ref: "vacation.jpg" });
    const meta = await Media.mediaMetaForStored(Files.listFiles()[0]);
    expect(meta?.kind).toBe("image");
    void f;
  });
});

describe("mediaUrlFor / releaseMediaUrl (Phase 1: browser-phase Blob URL seam)", () => {
  afterEach(() => {
    // Manual assignments to the real URL global (not vi.stubGlobal, per the
    // "preserve other URL statics" guidance) need manual cleanup.
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it("returns null gracefully for a metadata-only file, even with createObjectURL stubbed", async () => {
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => "blob:unused");
    const f = Files.addFileEntry({ title: "M", kind: "doc" });
    expect(await Media.mediaUrlFor(f.id)).toBeNull();
  });

  it("returns null when createObjectURL is unavailable, even for a byte-backed file", async () => {
    // Simulate the non-browser/unsupported case explicitly rather than
    // relying on the test environment's default (this jsdom version does
    // implement URL.createObjectURL).
    const original = URL.createObjectURL;
    (URL as unknown as Record<string, unknown>).createObjectURL = undefined;
    try {
      const png = new Uint8Array(20);
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const f = await Files.importFileBytes({ name: "cover.png", bytes: png });
      expect(await Media.mediaUrlFor(f.id)).toBeNull();
    } finally {
      (URL as unknown as Record<string, unknown>).createObjectURL = original;
    }
  });

  it("returns a Blob URL with the content-detected mime when createObjectURL is stubbed", async () => {
    const png = new Uint8Array(20);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const f = await Files.importFileBytes({ name: "cover.png", bytes: png });
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;

    const result = await Media.mediaUrlFor(f.id);
    expect(result).toEqual({ url: "blob:mock-url", mime: "image/png" });
    expect(createObjectURL).toHaveBeenCalled();

    Media.releaseMediaUrl(result!.url);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
