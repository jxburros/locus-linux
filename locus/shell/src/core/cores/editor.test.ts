import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EditorModule from "./editor";

let Editor: typeof EditorModule;
let Objects: typeof import("../objects");

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Editor = await import("./editor");
  Objects = await import("../objects");
});

describe("selection model", () => {
  it("selectedText handles a forward selection", () => {
    expect(Editor.selectedText("hello world", { start: 0, end: 5 })).toBe("hello");
  });

  it("selectedText normalizes a reversed selection", () => {
    expect(Editor.selectedText("hello world", { start: 5, end: 0 })).toBe("hello");
  });

  it("replaceSelection substitutes the selected range", () => {
    expect(Editor.replaceSelection("hello world", { start: 6, end: 11 }, "there")).toBe(
      "hello there",
    );
  });
});

describe("transformText", () => {
  it.each([
    ["uppercase", "Hello World", "HELLO WORLD"],
    ["lowercase", "Hello World", "hello world"],
    ["titlecase", "hello world", "Hello World"],
  ] as const)("%s", (kind, input, expected) => {
    expect(Editor.transformText(input, kind)).toBe(expected);
  });

  it("trim-lines strips trailing whitespace per line, keeping structure", () => {
    expect(Editor.transformText("a  \nb\t\nc", "trim-lines")).toBe("a\nb\nc");
  });
});

describe("createUndoStack", () => {
  it("tracks current value and undo/redo availability", () => {
    const stack = Editor.createUndoStack("a");
    expect(stack.current()).toBe("a");
    expect(stack.canUndo()).toBe(false);
    stack.push("b");
    expect(stack.current()).toBe("b");
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("undo/redo restore prior/next values", () => {
    const stack = Editor.createUndoStack("a");
    stack.push("b");
    stack.push("c");
    expect(stack.undo()).toBe("b");
    expect(stack.undo()).toBe("a");
    expect(stack.undo()).toBeNull(); // nothing further back
    expect(stack.redo()).toBe("b");
    expect(stack.redo()).toBe("c");
    expect(stack.redo()).toBeNull();
  });

  it("pushing after an undo discards the old redo branch", () => {
    const stack = Editor.createUndoStack("a");
    stack.push("b");
    stack.undo();
    stack.push("c");
    expect(stack.canRedo()).toBe(false);
    expect(stack.current()).toBe("c");
  });

  it("skips a push that is reference-identical to the current value", () => {
    const stack = Editor.createUndoStack("a");
    stack.push("a");
    expect(stack.canUndo()).toBe(false);
  });

  it("bounds history at the given limit", () => {
    const stack = Editor.createUndoStack(0, 3);
    for (let i = 1; i <= 10; i++) stack.push(i);
    let undone = 0;
    while (stack.undo() !== null) undone++;
    expect(undone).toBe(3); // limit caps how far back undo can go
  });
});

describe("applyOpsToText", () => {
  it("applies a replace-range op", () => {
    expect(
      Editor.applyOpsToText("hello world", [{ kind: "replace-range", at: 6, end: 11, text: "there" }]),
    ).toBe("hello there");
  });

  it("applies an insert op without removing anything", () => {
    expect(Editor.applyOpsToText("hello world", [{ kind: "insert", at: 5, text: "," }])).toBe(
      "hello, world",
    );
  });

  it("applies an append op after everything else", () => {
    expect(Editor.applyOpsToText("hello", [{ kind: "append", text: " world" }])).toBe(
      "hello world",
    );
  });

  it("applies multiple non-overlapping positioned ops correctly, back-to-front", () => {
    const result = Editor.applyOpsToText("The quick brown fox", [
      { kind: "replace-range", at: 4, end: 9, text: "slow" },
      { kind: "replace-range", at: 16, end: 19, text: "cat" },
    ]);
    expect(result).toBe("The slow brown cat");
  });

  it("clamps out-of-range offsets to the document bounds", () => {
    expect(
      Editor.applyOpsToText("hi", [{ kind: "replace-range", at: -5, end: 999, text: "yo" }]),
    ).toBe("yo");
  });

  it("throws on overlapping ranges", () => {
    expect(() =>
      Editor.applyOpsToText("hello world", [
        { kind: "replace-range", at: 0, end: 6, text: "a" },
        { kind: "replace-range", at: 4, end: 8, text: "b" },
      ]),
    ).toThrow(/overlap/);
  });

  it("throws when a replace-range op omits at/end", () => {
    expect(() => Editor.applyOpsToText("hello", [{ kind: "replace-range", text: "x" }])).toThrow(
      /at\/end/,
    );
  });

  it("ignores set-title ops (no text mutation)", () => {
    expect(
      Editor.applyOpsToText("hello", [{ kind: "set-title", text: "New title" }]),
    ).toBe("hello");
  });
});

describe("diffLines", () => {
  it("marks identical lines as same", () => {
    const diff = Editor.diffLines("a\nb\nc", "a\nb\nc");
    expect(diff.every((d) => d.kind === "same")).toBe(true);
  });

  it("marks a changed line as removed+added", () => {
    const diff = Editor.diffLines("a\nb\nc", "a\nX\nc");
    expect(diff.map((d) => d.kind)).toEqual(["same", "removed", "added", "same"]);
  });

  it("falls back to whole-block replace above the LCS size threshold", () => {
    const a = Array.from({ length: 501 }, (_, i) => `line-a-${i}`).join("\n");
    const b = Array.from({ length: 501 }, (_, i) => `line-b-${i}`).join("\n");
    const diff = Editor.diffLines(a, b);
    expect(diff.filter((d) => d.kind === "removed")).toHaveLength(501);
    expect(diff.filter((d) => d.kind === "added")).toHaveLength(501);
  });
});

describe("previewTransaction / proposeEditTransaction", () => {
  it("previewTransaction returns null for a missing target", () => {
    expect(Editor.previewTransaction({ targetId: "missing", label: "x", ops: [] })).toBeNull();
  });

  it("previewTransaction computes a diff without mutating the object", () => {
    const doc = Objects.createObject({ type: "document", title: "Doc", body: "hello world" });
    const preview = Editor.previewTransaction({
      targetId: doc.id,
      label: "Rewrite greeting",
      ops: [{ kind: "replace-range", at: 0, end: 5, text: "howdy" }],
    });
    expect(preview?.before).toBe("hello world");
    expect(preview?.after).toBe("howdy world");
    expect(preview?.added).toBeGreaterThan(0);
    expect(Objects.getObject(doc.id)?.body).toBe("hello world"); // unchanged
  });

  it("previewTransaction returns null for invalid (overlapping) ops", () => {
    const doc = Objects.createObject({ type: "document", title: "Doc", body: "hello world" });
    const preview = Editor.previewTransaction({
      targetId: doc.id,
      label: "Bad ops",
      ops: [
        { kind: "replace-range", at: 0, end: 6, text: "a" },
        { kind: "replace-range", at: 4, end: 8, text: "b" },
      ],
    });
    expect(preview).toBeNull();
  });

  it("proposeEditTransaction returns null for a missing target", async () => {
    expect(
      await Editor.proposeEditTransaction({ targetId: "missing", label: "x", ops: [] }),
    ).toBeNull();
  });

  it("proposeEditTransaction creates a proposal carrying the computed body and baseUpdatedAt", async () => {
    const doc = Objects.createObject({ type: "document", title: "Doc", body: "hello world" });
    const proposal = await Editor.proposeEditTransaction({
      targetId: doc.id,
      label: "Rewrite greeting",
      ops: [{ kind: "replace-range", at: 0, end: 5, text: "howdy" }],
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.effect.kind).toBe("update");
    expect(proposal!.effect.targetId).toBe(doc.id);
    expect(proposal!.effect.baseUpdatedAt).toBe(doc.updatedAt);
    expect(proposal!.effect.payload?.body).toBe("howdy world");
    expect(proposal!.app).toBe("writer"); // document -> writer per APP_FOR_TARGET
  });

  it("proposeEditTransaction includes a title change only when set-title carries a defined text", async () => {
    const doc = Objects.createObject({ type: "document", title: "Old title", body: "body" });
    const proposal = await Editor.proposeEditTransaction({
      targetId: doc.id,
      label: "Rename",
      ops: [{ kind: "set-title", text: "New title" }],
    });
    expect(proposal!.effect.payload?.title).toBe("New title");
  });

  it("proposeEditTransaction routes a card target through the cards app", async () => {
    const card = Objects.createObject({ type: "card", title: "Card", body: "note" });
    const proposal = await Editor.proposeEditTransaction({
      targetId: card.id,
      label: "Edit card",
      ops: [{ kind: "append", text: " more" }],
    });
    expect(proposal!.app).toBe("cards");
  });
});

describe("monotonic version token (Wave 3)", () => {
  it("carries baseRev on the effect, and a same-millisecond edit still invalidates it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    const Broker = await import("../broker");
    const doc = Objects.createObject({ type: "document", title: "Doc", body: "hello" });
    const proposal = await Editor.proposeEditTransaction({
      targetId: doc.id,
      label: "Rewrite",
      ops: [{ kind: "append", text: " world" }],
    });
    expect(proposal!.effect.baseRev).toBe(doc.rev);
    // A user edit lands in the SAME millisecond (no timer advance): updatedAt
    // cannot see it, the revision can.
    Objects.updateObject(doc.id, { body: "hello edited" });
    expect(Objects.getObject(doc.id)!.updatedAt).toBe(doc.updatedAt);
    Storage: {
      // Force to approved and execute — the stale base must refuse.
      const { storage, StoreKeys } = await import("../storage");
      const list = storage.get<import("@/types").ActionProposal[]>(StoreKeys.proposals, []);
      storage.set(
        StoreKeys.proposals,
        list.map((p) => (p.id === proposal!.id ? { ...p, status: "approved" as const } : p)),
      );
    }
    const out = await Broker.execute(proposal!.id);
    expect(out?.status).toBe("failed");
    expect(out?.error).toMatch(/changed after this was proposed/i);
    expect(Objects.getObject(doc.id)!.body).toBe("hello edited"); // newer edit preserved
    vi.useRealTimers();
  });
});
