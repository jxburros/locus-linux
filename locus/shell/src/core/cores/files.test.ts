import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FilesModule from "./files";
import type * as SourcesModule from "../sources";

let Files: typeof FilesModule;
let Sources: typeof SourcesModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Files = await import("./files");
  Sources = await import("../sources");
});

describe("addFileEntry / listFiles / recentFiles", () => {
  it("adds a file entry and lists it", () => {
    const f = Files.addFileEntry({ title: "Report.pdf", kind: "doc", sizeBytes: 2048 });
    expect(Files.listFiles().map((x) => x.id)).toEqual([f.id]);
  });

  it("recentFiles sorts by updatedAt, newest first, capped at the limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const a = Files.addFileEntry({ title: "A", kind: "doc" });
    vi.advanceTimersByTime(1);
    const b = Files.addFileEntry({ title: "B", kind: "doc" });
    vi.advanceTimersByTime(1);
    Files.renameFile(a.id, "A renamed"); // bumps A's updatedAt past B's
    const recent = Files.recentFiles(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe(a.id);
    vi.useRealTimers();
    void b;
  });
});

describe("trash / restore / emptyTrash", () => {
  it("trashFile moves a file out of listFiles and into trashedFiles", () => {
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.trashFile(f.id);
    expect(Files.listFiles()).toHaveLength(0);
    expect(Files.trashedFiles().map((x) => x.id)).toEqual([f.id]);
  });

  it("trashFile is a no-op on an already-trashed file", () => {
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.trashFile(f.id);
    const deletedAt = Files.trashedFiles()[0].file?.deletedAt;
    Files.trashFile(f.id);
    expect(Files.trashedFiles()[0].file?.deletedAt).toBe(deletedAt);
  });

  it("restoreFile brings a file back and re-stales its index state", () => {
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.trashFile(f.id);
    Files.restoreFile(f.id);
    expect(Files.listFiles().map((x) => x.id)).toEqual([f.id]);
    const restored = Files.listFiles()[0];
    expect(restored.file?.deletedAt).toBeUndefined();
    expect(restored.indexState).toBe("stale");
  });

  it("restoreFile keeps a deliberately-excluded file excluded, not re-indexed", async () => {
    const Objects = await import("../objects");
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Objects.updateObject(f.id, { indexState: "excluded" }, { silent: true });
    Files.trashFile(f.id);
    Files.restoreFile(f.id);
    expect(Files.listFiles()[0].indexState).toBe("excluded");
  });

  it("does NOT treat a plain 'trash' tag as trashed (2026-07-10 audit collision fix)", async () => {
    const Objects = await import("../objects");
    const f = Files.addFileEntry({ title: "Tagged", kind: "doc" });
    // A user tagging a file "trash" is a label, not a soft-delete. Without the
    // fix, emptyTrash() could permanently delete this file.
    Objects.updateObject(f.id, { tags: ["trash"] }, { silent: true });
    expect(Files.listFiles().map((x) => x.id)).toEqual([f.id]);
    expect(Files.trashedFiles()).toHaveLength(0);
  });

  it("migrates a legacy tag-trashed file to the deletedAt field at boot", async () => {
    const Objects = await import("../objects");
    const f = Files.addFileEntry({ title: "Legacy", kind: "doc" });
    // Simulate a file trashed by the pre-deletedAt build (tag only).
    Objects.updateObject(f.id, { tags: ["trash"] }, { silent: true });
    // Boot migration converts the tag into real trash state and strips the tag.
    Files.initFilesCore();
    const migrated = Objects.getObject(f.id);
    expect(migrated?.file?.deletedAt).toBeTruthy();
    expect(migrated?.tags).not.toContain("trash");
    expect(Files.trashedFiles().map((x) => x.id)).toEqual([f.id]);
    expect(Files.listFiles()).toHaveLength(0);
  });

  it("emptyTrash permanently deletes only trashed files, and only with a valid token", async () => {
    const kept = Files.addFileEntry({ title: "Kept", kind: "doc" });
    const trashed = Files.addFileEntry({ title: "Trashed", kind: "doc" });
    Files.trashFile(trashed.id);
    // No token / a bogus token: nothing is destroyed.
    expect(await Files.emptyTrash("not-a-token")).toBe(0);
    expect(Files.trashedFiles()).toHaveLength(1);
    // The two-step contract: mint, then spend.
    const { token, count } = Files.requestEmptyTrash();
    expect(count).toBe(1);
    expect(await Files.emptyTrash(token)).toBe(1);
    expect(Files.listFiles().map((x) => x.id)).toEqual([kept.id]);
    expect(Files.trashedFiles()).toHaveLength(0);
    // The token is one-shot — replaying it destroys nothing.
    Files.trashFile(kept.id);
    expect(await Files.emptyTrash(token)).toBe(0);
    expect(Files.trashedFiles()).toHaveLength(1);
  });
});

describe("renameFile", () => {
  it("renames a file", () => {
    const f = Files.addFileEntry({ title: "Old", kind: "doc" });
    const renamed = Files.renameFile(f.id, "New");
    expect(renamed?.title).toBe("New");
  });

  it("returns undefined for a non-file object", async () => {
    const Objects = await import("../objects");
    const card = Objects.createObject({ type: "card", title: "Card" });
    expect(Files.renameFile(card.id, "New")).toBeUndefined();
  });
});

describe("sourceGrants", () => {
  it("returns only readable connected sources", () => {
    Sources.seedIfEmpty();
    const grants = Files.sourceGrants();
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((s) => s.readable)).toBe(true);

    Sources.setReadable("local", false);
    expect(Files.sourceGrants().some((s) => s.id === "local")).toBe(false);
  });
});

describe("file access grants + brokered access", () => {
  it("requestFileAccess refuses for a trashed or missing file", async () => {
    expect(await Files.requestFileAccess("missing", "test")).toBeNull();
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.trashFile(f.id);
    expect(await Files.requestFileAccess(f.id, "test")).toBeNull();
  });

  it("requestFileAccess creates a proposal and initFilesCore's executor mints a revocable grant", async () => {
    const f = Files.addFileEntry({ title: "Report.pdf", kind: "doc", sizeBytes: 4096 });
    Files.initFilesCore();
    const proposal = await Files.requestFileAccess(f.id, "summarize it");
    expect(proposal).not.toBeNull();

    // A read-only external effect is allowed without capability checks, so
    // whether it auto-executes depends only on a matching trusted action;
    // by default there is none, so it should sit pending for approval.
    expect(["pending", "approved"]).toContain(proposal!.status);
  });

  it("consumeFileGrant returns null when no unused grant exists", () => {
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    expect(Files.consumeFileGrant(f.id)).toBeNull();
  });

  it("approval mints an UNCONSUMED grant; openFileWithGrant consumes it exactly once", async () => {
    const Broker = await import("../broker");
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.initFilesCore();
    const proposal = await Files.requestFileAccess(f.id, "test");
    expect(proposal).not.toBeNull();
    if (proposal!.status === "pending") {
      await Broker.approve(proposal!.id);
    }
    // Approval mints; it does not consume — the grant sits revocable.
    const grant = Files.listFileGrants().find((g) => g.fileId === f.id);
    expect(grant).toBeTruthy();
    expect(grant!.usedAt).toBeUndefined();
    expect(Files.isGrantUsable(grant!)).toBe(true);
    // The open is THE consumption point, and it releases the redacted content.
    const content = await Files.openFileWithGrant(grant!.id);
    expect(content?.meta).toContain("F");
    expect(content?.bytes).toBeUndefined(); // metadata-only file: no bytes to release
    // One-shot: a second open releases nothing.
    expect(await Files.openFileWithGrant(grant!.id)).toBeNull();
    expect(Files.listFileGrants().find((g) => g.id === grant!.id)?.usedAt).toBeTruthy();
  });

  it("openFileWithGrant refuses at open time when the file was trashed after approval", async () => {
    const Broker = await import("../broker");
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.initFilesCore();
    const proposal = await Files.requestFileAccess(f.id, "test");
    if (proposal!.status === "pending") await Broker.approve(proposal!.id);
    const grant = Files.listFileGrants().find((g) => g.fileId === f.id)!;
    Files.trashFile(f.id); // state changed between approval and open
    expect(await Files.openFileWithGrant(grant.id)).toBeNull();
  });

  it("a revoked grant cannot be opened; an expired grant cannot be consumed", async () => {
    const Broker = await import("../broker");
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.initFilesCore();
    const p1 = await Files.requestFileAccess(f.id, "revoke me");
    if (p1!.status === "pending") await Broker.approve(p1!.id);
    const grant = Files.listFileGrants().find((g) => g.fileId === f.id)!;
    expect(Files.revokeFileGrant(grant.id)).toBe(true);
    expect(await Files.openFileWithGrant(grant.id)).toBeNull();

    // Expiry: fabricate a stale grant via the public shape check.
    const expired = { ...grant, expiresAt: Date.now() - 1, usedAt: undefined };
    expect(Files.isGrantUsable(expired)).toBe(false);
  });
});

describe("fileMetaForAI", () => {
  it("never returns metadata for a trashed or missing file", () => {
    expect(Files.fileMetaForAI("missing")).toBeNull();
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.trashFile(f.id);
    expect(Files.fileMetaForAI(f.id)).toBeNull();
  });

  it("describes kind and a human-readable size", () => {
    const f = Files.addFileEntry({ title: "Report.pdf", kind: "doc", sizeBytes: 2048 });
    const meta = Files.fileMetaForAI(f.id);
    expect(meta).toContain("Report.pdf");
    expect(meta).toContain("doc");
    expect(meta).toContain("2 KB");
  });

  it("redacts likely secrets embedded in a file summary", async () => {
    const Objects = await import("../objects");
    const f = Files.addFileEntry({ title: "Notes", kind: "doc" });
    Objects.updateObject(f.id, { file: { kind: "doc", summary: "key sk-ABCDEFGHIJKLMNOPQRSTUVWX" } });
    const meta = Files.fileMetaForAI(f.id);
    expect(meta).toContain("[redacted: OpenAI key]");
  });
});

describe("importFileBytes / readFileBytes / hasStoredBytes / storedByteUsage (Phase 1 byte store)", () => {
  /** A minimal, valid PNG header — enough for detectMediaFromBytes to
      recognize it as image/png (needs >= 12 bytes). */
  function pngBytes(size = 20): Uint8Array {
    const arr = new Uint8Array(size);
    arr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return arr;
  }

  it("detects kind from magic numbers (content wins over an unrelated name) and records real size", async () => {
    const bytes = pngBytes(50);
    const f = await Files.importFileBytes({ name: "photo.dat", bytes });
    expect(f.file?.kind).toBe("image");
    expect(f.file?.sizeBytes).toBe(50);
    expect(Files.hasStoredBytes(f)).toBe(true);
    expect(f.file?.ref).toBe(`bytes:${f.id}`);
  });

  it("falls back to an extension-based kind when the bytes are not recognized media", async () => {
    const text = new TextEncoder().encode("just some plain text content, well over twelve bytes long");
    const doc = await Files.importFileBytes({ name: "notes.txt", bytes: text });
    expect(doc.file?.kind).toBe("doc");
    const other = await Files.importFileBytes({ name: "blob.xyz", bytes: text });
    expect(other.file?.kind).toBe("other");
  });

  it("readFileBytes round-trips the stored content", async () => {
    const bytes = pngBytes(30);
    const f = await Files.importFileBytes({ name: "a.png", bytes });
    expect(await Files.readFileBytes(f.id)).toEqual(bytes);
  });

  it("readFileBytes returns null for a missing id, a metadata-only file, and a trashed file", async () => {
    expect(await Files.readFileBytes("missing")).toBeNull();
    const metaOnly = Files.addFileEntry({ title: "M", kind: "doc" });
    expect(await Files.readFileBytes(metaOnly.id)).toBeNull();
    const f = await Files.importFileBytes({ name: "a.png", bytes: pngBytes() });
    Files.trashFile(f.id);
    expect(await Files.readFileBytes(f.id)).toBeNull();
  });

  it("openFileWithGrant releases bytes and content-detected mime for a byte-backed file, and still one-shot-consumes", async () => {
    const Broker = await import("../broker");
    const bytes = pngBytes(40);
    const f = await Files.importFileBytes({ name: "cover.png", bytes });
    Files.initFilesCore();
    const proposal = await Files.requestFileAccess(f.id, "preview");
    if (proposal!.status === "pending") await Broker.approve(proposal!.id);
    const grant = Files.listFileGrants().find((g) => g.fileId === f.id)!;
    const opened = await Files.openFileWithGrant(grant.id);
    expect(opened?.meta).toContain("cover.png");
    expect(opened?.bytes).toEqual(bytes);
    expect(opened?.mime).toBe("image/png");
    // One-shot, exactly like the metadata-only path.
    expect(await Files.openFileWithGrant(grant.id)).toBeNull();
  });

  it("emptyTrash purges the underlying byte-store entry, not just the metadata object", async () => {
    const ByteStore = await import("../byteStore");
    const f = await Files.importFileBytes({ name: "a.png", bytes: pngBytes() });
    expect(await ByteStore.readBytes(f.id)).not.toBeNull();
    Files.trashFile(f.id);
    const { token } = Files.requestEmptyTrash();
    expect(await Files.emptyTrash(token)).toBe(1);
    expect(await ByteStore.readBytes(f.id)).toBeNull();
  });

  it("storedByteUsage reflects the manifest and drops entries emptyTrash purges", async () => {
    expect(Files.storedByteUsage()).toEqual({ count: 0, totalBytes: 0 });
    const a = await Files.importFileBytes({ name: "a.png", bytes: pngBytes(10) });
    await Files.importFileBytes({ name: "b.png", bytes: pngBytes(20) });
    expect(Files.storedByteUsage()).toEqual({ count: 2, totalBytes: 30 });
    Files.trashFile(a.id);
    const { token } = Files.requestEmptyTrash();
    await Files.emptyTrash(token);
    expect(Files.storedByteUsage()).toEqual({ count: 1, totalBytes: 20 });
  });
});
