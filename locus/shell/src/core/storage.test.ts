import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as StorageModule from "./storage";

// Wave 2 persistence primitives: the transactional locked update path and the
// IndexedDB durable mirror. fake-indexeddb provides a real (in-memory)
// IndexedDB implementation, so the mirror code path under test is the same
// one the browser runs — not a mock of our own layer.

let Storage: typeof StorageModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  const { IDBFactory } = await import("fake-indexeddb");
  // A fresh factory per test isolates the durable DB between tests.
  globalThis.indexedDB = new IDBFactory();
  Storage = await import("./storage");
});

describe("storage.update — transactional read-modify-write", () => {
  it("applies the mutation against the freshest persisted value", async () => {
    Storage.storage.set("test.counter", 1);
    // Simulate another writer landing between cache and update: write raw.
    localStorage.setItem("locus:test.counter", "5");
    const out = await Storage.storage.update<number>("test.counter", 0, (n) => n + 1);
    expect(out).toBe(6);
    expect(Storage.storage.get("test.counter", 0)).toBe(6);
  });

  it("serializes concurrent updates so none is lost", async () => {
    Storage.storage.set("test.list", [] as number[]);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Storage.storage.update<number[]>("test.list", [], (list) => [...list, i]),
      ),
    );
    expect(Storage.storage.get<number[]>("test.list", [])).toHaveLength(20);
  });

  it("keeps the queue alive after a mutator throws", async () => {
    await expect(
      Storage.storage.update<number>("test.x", 0, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const out = await Storage.storage.update<number>("test.x", 0, (n) => n + 1);
    expect(out).toBe(1);
  });
});

describe("stable references (useSyncExternalStore safety)", () => {
  it("returns the SAME reference for an absent key across calls", () => {
    // A fresh `[]` literal per call would hand useSyncExternalStore a new
    // snapshot every render and spin an infinite re-render loop (the bug the
    // real-browser suite caught). An absent key must read back one reference.
    const a = Storage.storage.get("nope.absent", [], Array.isArray);
    const b = Storage.storage.get("nope.absent", [], Array.isArray);
    expect(a).toBe(b);
  });

  it("returns a stable reference for a present array until it actually changes", () => {
    Storage.storage.set("some.list", [1, 2, 3]);
    const a = Storage.storage.get<number[]>("some.list", []);
    const b = Storage.storage.get<number[]>("some.list", []);
    expect(a).toBe(b);
    Storage.storage.set("some.list", [1, 2, 3, 4]);
    const c = Storage.storage.get<number[]>("some.list", []);
    expect(c).not.toBe(a);
  });

  it("falls back to a stable reference when a present value is invalid", () => {
    localStorage.setItem("locus:bad.shape", JSON.stringify({ not: "an array" }));
    const a = Storage.storage.get("bad.shape", [], Array.isArray);
    const b = Storage.storage.get("bad.shape", [], Array.isArray);
    expect(a).toBe(b);
  });
});

describe("durable mirror — IndexedDB records", () => {
  it("mirrors writes as records with monotonic revisions", async () => {
    Storage.storage.set("test.a", { v: 1 });
    Storage.storage.set("test.a", { v: 2 });
    await Storage.durableMirrorSettled();
    Storage.storage.set("test.a", { v: 3 });
    await Storage.durableMirrorSettled();
    const records = await Storage.readDurableRecords();
    const rec = records.find((r) => r.key === "test.a");
    expect(rec).toBeTruthy();
    // Coalesced flushes mean at least two distinct revisions landed.
    expect(rec!.rev).toBeGreaterThanOrEqual(2);
  });

  it("restores a record localStorage lost (hydration)", async () => {
    Storage.storage.set("test.keep", { important: true });
    await Storage.durableMirrorSettled();
    // Simulate localStorage loss (eviction / site-data clear of localStorage only).
    localStorage.removeItem("locus:test.keep");
    const recovered = await Storage.hydrateDurable();
    expect(recovered).toContain("test.keep");
    expect(Storage.storage.get("test.keep", null)).toEqual({ important: true });
  });

  it("recovers a quota-failed write on the next boot (memory-only record)", async () => {
    Storage.storage.set("test.doc", "old");
    await Storage.durableMirrorSettled();
    // Make the NEXT localStorage write fail, like a full quota would.
    const original = localStorage.setItem.bind(localStorage);
    const spy = vi
      .spyOn(globalThis.Storage.prototype, "setItem")
      .mockImplementation(function (this: unknown, key: string, value: string) {
        if (key === "locus:test.doc") throw new Error("QuotaExceededError");
        return original(key, value);
      });
    const failures: string[] = [];
    Storage.onStorageFailure((f) => failures.push(f.kind));
    Storage.storage.set("test.doc", "newest");
    expect(failures).toContain("write-failed");
    await Storage.durableMirrorSettled();
    spy.mockRestore();

    // "Reload": a fresh module world with the same localStorage + IndexedDB.
    vi.resetModules();
    const Reloaded = await import("./storage");
    // Before hydration, localStorage still holds the stale value.
    expect(localStorage.getItem("locus:test.doc")).toBe(JSON.stringify("old"));
    const recovered = await Reloaded.hydrateDurable();
    expect(recovered).toContain("test.doc");
    expect(Reloaded.storage.get("test.doc", "")).toBe("newest");
  });

  it("does not resurrect explicitly removed keys", async () => {
    Storage.storage.set("test.gone", 42);
    await Storage.durableMirrorSettled();
    Storage.storage.remove("test.gone");
    await Storage.durableMirrorSettled();
    const recovered = await Storage.hydrateDurable();
    expect(recovered).not.toContain("test.gone");
    expect(Storage.storage.get("test.gone", null)).toBeNull();
  });

  it("clearAll clears the mirror too, so a user reset stays reset", async () => {
    Storage.storage.set("test.wipe", "x");
    await Storage.durableMirrorSettled();
    Storage.storage.clearAll();
    await Storage.durableMirrorSettled();
    const records = await Storage.readDurableRecords();
    expect(records.find((r) => r.key === "test.wipe")).toBeUndefined();
  });

  it("export still includes memory-only (quota-failed) values", () => {
    const original = localStorage.setItem.bind(localStorage);
    const spy = vi
      .spyOn(globalThis.Storage.prototype, "setItem")
      .mockImplementation(function (this: unknown, key: string, value: string) {
        if (key.startsWith("locus:test.mem")) throw new Error("full");
        return original(key, value);
      });
    Storage.storage.set("test.mem", { rescued: true });
    const exported = Storage.storage.exportAll();
    expect(exported.memoryOnlyKeys).toContain("test.mem");
    expect(exported.data["test.mem"]).toEqual({ rescued: true });
    spy.mockRestore();
  });
});
