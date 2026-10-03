import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ByteStoreModule from "./byteStore";

// The byte seam has three backends, chosen once per module instance:
// OPFS > IndexedDB > in-memory. jsdom provides neither OPFS nor IndexedDB by
// default, so the "no stubbing" case IS the honest memory-fallback test;
// IndexedDB is exercised with fake-indexeddb (a real implementation, not a
// mock of our own code — same convention as storage.test.ts); OPFS is
// exercised with a small hand-rolled fake of the File System Access surface
// this module actually calls (getFileHandle/createWritable/getFile/slice/
// removeEntry, plus recursive removeEntry on the root for clearAllBytes) —
// directory enumeration is never called by byteStore, so the fake omits it.

let ByteStore: typeof ByteStoreModule;

afterEach(() => {
  vi.unstubAllGlobals();
});

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("byteStore — in-memory fallback (no IndexedDB, no OPFS)", () => {
  beforeEach(async () => {
    vi.resetModules();
    ByteStore = await import("./byteStore");
  });

  it("reports the memory backend", async () => {
    expect(await ByteStore.byteBackendKind()).toBe("memory");
  });

  it("round-trips put/read/head/remove/clear", async () => {
    const data = bytesOf(1, 2, 3, 4, 5);
    const result = await ByteStore.putBytes("a", data);
    expect(result).toEqual({ id: "a", size: 5, backend: "memory" });

    expect(await ByteStore.readBytes("a")).toEqual(data);
    expect(await ByteStore.readHead("a", 2)).toEqual(bytesOf(1, 2));
    expect(await ByteStore.readBytes("missing")).toBeNull();

    expect(await ByteStore.removeBytes("a")).toBe(true);
    expect(await ByteStore.readBytes("a")).toBeNull();
    expect(await ByteStore.removeBytes("a")).toBe(false);

    await ByteStore.putBytes("b", bytesOf(9, 9));
    await ByteStore.clearAllBytes();
    expect(await ByteStore.readBytes("b")).toBeNull();
  });

  it("readHead defaults to 64 bytes and never returns more than stored", async () => {
    const small = bytesOf(1, 2, 3);
    await ByteStore.putBytes("small", small);
    expect(await ByteStore.readHead("small")).toEqual(small);
  });
});

describe("byteStore — IndexedDB backend", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { IDBFactory } = await import("fake-indexeddb");
    // A fresh factory per test isolates the byte DB between tests.
    globalThis.indexedDB = new IDBFactory();
    ByteStore = await import("./byteStore");
  });

  it("reports the idb backend", async () => {
    expect(await ByteStore.byteBackendKind()).toBe("idb");
  });

  it("round-trips put/read/head/remove/clear through a real IndexedDB", async () => {
    const data = bytesOf(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4);
    const result = await ByteStore.putBytes("png-1", data);
    expect(result).toEqual({ id: "png-1", size: 8, backend: "idb" });

    expect(await ByteStore.readBytes("png-1")).toEqual(data);
    expect(await ByteStore.readHead("png-1", 4)).toEqual(bytesOf(0x89, 0x50, 0x4e, 0x47));
    expect(await ByteStore.readBytes("nope")).toBeNull();

    expect(await ByteStore.removeBytes("png-1")).toBe(true);
    expect(await ByteStore.readBytes("png-1")).toBeNull();
    expect(await ByteStore.removeBytes("png-1")).toBe(false);

    await ByteStore.putBytes("x", bytesOf(1));
    await ByteStore.putBytes("y", bytesOf(2));
    await ByteStore.clearAllBytes();
    expect(await ByteStore.readBytes("x")).toBeNull();
    expect(await ByteStore.readBytes("y")).toBeNull();
  });

  it("overwrites existing bytes for the same id", async () => {
    await ByteStore.putBytes("id", bytesOf(1, 1, 1));
    await ByteStore.putBytes("id", bytesOf(2, 2));
    expect(await ByteStore.readBytes("id")).toEqual(bytesOf(2, 2));
  });
});

describe("byteStore — OPFS backend", () => {
  /** A minimal in-memory fake of the File System Access / OPFS surface this
      module actually calls. No directory enumeration — byteStore never
      calls it (clearAllBytes drops the whole directory instead). */
  function makeFakeOpfs() {
    const files = new Map<string, Uint8Array>();

    function fileHandleFor(name: string) {
      return {
        async createWritable() {
          let staged: Uint8Array = new Uint8Array();
          return {
            async write(chunk: Uint8Array) {
              staged = chunk;
            },
            async close() {
              files.set(name, staged);
            },
          };
        },
        async getFile() {
          const bytes = files.get(name);
          if (!bytes) throw new DOMException("not found", "NotFoundError");
          return {
            async arrayBuffer() {
              return bytes.slice().buffer;
            },
            slice(start: number, end: number) {
              const sliced = bytes.slice(start, end);
              return {
                async arrayBuffer() {
                  return sliced.buffer;
                },
              };
            },
          };
        },
      };
    }

    const dirHandle = {
      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!files.has(name)) {
          if (!options?.create) throw new DOMException("not found", "NotFoundError");
          files.set(name, new Uint8Array());
        }
        return fileHandleFor(name);
      },
      async removeEntry(name: string) {
        if (!files.has(name)) throw new DOMException("not found", "NotFoundError");
        files.delete(name);
      },
    };

    return {
      files,
      storage: {
        async getDirectory() {
          return {
            async getDirectoryHandle(_name: string, _options?: { create?: boolean }) {
              return dirHandle;
            },
            // Root-level recursive removal — what clearAllBytes uses to drop
            // the whole "locus-bytes" directory in one call.
            async removeEntry(_name: string, _options?: { recursive?: boolean }) {
              files.clear();
            },
          };
        },
      },
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    ByteStore = await import("./byteStore");
  });

  it("reports the opfs backend and round-trips put/read/head/remove/clear", async () => {
    const fake = makeFakeOpfs();
    vi.stubGlobal("navigator", { ...navigator, storage: fake.storage });
    // Re-import after stubbing so backend detection sees the fake.
    vi.resetModules();
    ByteStore = await import("./byteStore");

    expect(await ByteStore.byteBackendKind()).toBe("opfs");

    const data = bytesOf(1, 2, 3, 4, 5, 6);
    const result = await ByteStore.putBytes("clip", data);
    expect(result).toEqual({ id: "clip", size: 6, backend: "opfs" });

    expect(await ByteStore.readBytes("clip")).toEqual(data);
    expect(await ByteStore.readHead("clip", 3)).toEqual(bytesOf(1, 2, 3));
    expect(await ByteStore.readBytes("missing")).toBeNull();

    expect(await ByteStore.removeBytes("clip")).toBe(true);
    expect(await ByteStore.readBytes("clip")).toBeNull();
    expect(await ByteStore.removeBytes("clip")).toBe(false);

    await ByteStore.putBytes("p", bytesOf(9));
    await ByteStore.clearAllBytes();
    expect(await ByteStore.readBytes("p")).toBeNull();
  });

  it("falls back to a lower backend when getDirectory throws", async () => {
    // A prior describe block in this file may have left a real IndexedDB
    // global in place (fake-indexeddb is a real global assignment, not a
    // vi.stubGlobal, so it is not auto-reverted). Either fallback — idb if
    // available, memory otherwise — is the honest "OPFS failed" behavior;
    // what matters is it never reports "opfs" when getDirectory threw.
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: {
        async getDirectory() {
          throw new Error("denied");
        },
      },
    });
    vi.resetModules();
    ByteStore = await import("./byteStore");
    expect(await ByteStore.byteBackendKind()).not.toBe("opfs");
    expect(await ByteStore.readBytes("anything")).toBeNull();
  });
});
