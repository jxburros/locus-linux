/*
 * Editor Core — shared editing behavior (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: selection, undo/redo, transformations, suggestions, export, and AI
 * edit transactions. Editor Core defines how edits happen, how they can be
 * previewed, and how they can be undone. It does not own the content model:
 * Cardspoke owns structured objects, Files owns file references, Dev Core
 * owns runnable code artifacts.
 *
 * The important AI principle lives here: AI does not edit invisibly. An AI
 * edit is a *transaction* of structured ops that can be inspected as a diff
 * preview, approved, undone, or modified — routed through the AI Broker's
 * proposal queue, never applied directly. Transactions carry the document
 * version they were computed against (baseUpdatedAt), so approving a stale
 * one fails instead of silently overwriting newer edits.
 */

import { proposeThroughCore } from "./ai";
import { record } from "../audit";
import { getObject } from "../objects";
import type { ActionProposal, AppId, ObjectType } from "@/types";

/* ------------------------------ selection model ---------------------------- */

export interface EditorSelection {
  start: number;
  end: number;
}

export function selectedText(text: string, sel: EditorSelection): string {
  return text.slice(Math.min(sel.start, sel.end), Math.max(sel.start, sel.end));
}

export function replaceSelection(text: string, sel: EditorSelection, replacement: string): string {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  return text.slice(0, start) + replacement + text.slice(end);
}

/* ------------------------------ transformations ----------------------------- */

export type TextTransform = "uppercase" | "lowercase" | "titlecase" | "trim-lines";

export const TEXT_TRANSFORMS: { id: TextTransform; label: string }[] = [
  { id: "uppercase", label: "UPPERCASE" },
  { id: "lowercase", label: "lowercase" },
  { id: "titlecase", label: "Title Case" },
  { id: "trim-lines", label: "Trim line ends" },
];

/** The shared transformation vocabulary every editor surface can offer. */
export function transformText(text: string, transform: TextTransform): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "titlecase":
      return text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    case "trim-lines":
      return text
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .join("\n");
  }
}

/* -------------------------------- undo / redo ------------------------------ */

export interface UndoStack<T> {
  current(): T;
  push(next: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** A bounded undo/redo stack any editor surface can own per document. */
export function createUndoStack<T>(initial: T, limit = 100): UndoStack<T> {
  let past: T[] = [];
  let present = initial;
  let future: T[] = [];
  return {
    current: () => present,
    push(next: T) {
      if (Object.is(next, present)) return;
      past = [...past.slice(-(limit - 1)), present];
      present = next;
      future = [];
    },
    undo() {
      if (past.length === 0) return null;
      future = [present, ...future];
      present = past[past.length - 1];
      past = past.slice(0, -1);
      return present;
    },
    redo() {
      if (future.length === 0) return null;
      past = [...past, present];
      present = future[0];
      future = future.slice(1);
      return present;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}

/* ---------------------------- AI edit transactions -------------------------- */

export type EditOpKind = "replace-range" | "insert" | "append" | "set-title";

export interface EditOp {
  kind: EditOpKind;
  /** Character offsets into the ORIGINAL document for replace-range/insert. */
  at?: number;
  end?: number;
  text?: string;
}

export interface EditTransaction {
  targetId: string;
  label: string;
  ops: EditOp[];
}

/**
 * Apply structured ops to text — the same function previews and executes.
 * All offsets address the ORIGINAL document (the natural shape for a model
 * to emit): positioned ops apply back-to-front so earlier offsets stay
 * valid, and overlapping ranges are rejected rather than silently corrupting
 * the output. Appends run last, in the order given. Throws on overlap.
 */
export function applyOpsToText(text: string, ops: EditOp[]): string {
  const positioned = ops
    .filter((o) => o.kind === "replace-range" || o.kind === "insert")
    .map((o) => {
      // A replace-range must say what it replaces. Defaulting omitted
      // offsets would silently turn a truncated op into "replace the whole
      // document" — reject it like an overlap instead.
      if (o.kind === "replace-range" && (o.at === undefined || o.end === undefined)) {
        throw new Error("replace-range op is missing its at/end offsets");
      }
      const at = Math.max(0, Math.min(o.at ?? (o.kind === "insert" ? text.length : 0), text.length));
      const end =
        o.kind === "replace-range"
          ? Math.max(at, Math.min(o.end ?? text.length, text.length))
          : at;
      return { at, end, text: o.text ?? "" };
    })
    .sort((a, b) => a.at - b.at || a.end - b.end);

  for (let i = 1; i < positioned.length; i++) {
    if (positioned[i].at < positioned[i - 1].end) {
      throw new Error(
        `edit ops overlap (ranges ${positioned[i - 1].at}–${positioned[i - 1].end} and ${positioned[i].at}–${positioned[i].end})`,
      );
    }
  }

  let out = text;
  for (let i = positioned.length - 1; i >= 0; i--) {
    const op = positioned[i];
    out = out.slice(0, op.at) + op.text + out.slice(op.end);
  }
  for (const op of ops) {
    if (op.kind === "append") out = out + (op.text ?? "");
  }
  return out;
}

/* -------------------------------- diff preview ------------------------------ */

export type DiffLineKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Line diff (LCS) so edits are inspectable before they apply. Shared grammar:
 * Editor Core previews text transactions with it and Dev Core previews code
 * changes with it. Falls back to whole-block replace on very large inputs.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 250_000) {
    return [
      ...a.map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  // Standard LCS table over lines.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      out.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

export interface TransactionPreview {
  targetId: string;
  label: string;
  before: string;
  after: string;
  diff: DiffLine[];
  added: number;
  removed: number;
  /**
   * Present when the transaction renames the object. Without this, a
   * rename-only transaction (a lone set-title op) produced an empty body diff
   * and the approval preview showed no change at all while the title still
   * executed.
   */
  titleBefore?: string;
  titleAfter?: string;
}

/** Compute exactly what a transaction would change, without applying it.
    Returns null when the target is gone or the ops are invalid (overlap). */
export function previewTransaction(tx: EditTransaction): TransactionPreview | null {
  const target = getObject(tx.targetId);
  if (!target) return null;
  const before = target.body ?? "";
  let after: string;
  try {
    after = applyOpsToText(before, tx.ops.filter((o) => o.kind !== "set-title"));
  } catch {
    return null;
  }
  const diff = diffLines(before, after);
  const titleOp = tx.ops.find((o) => o.kind === "set-title");
  const titleAfter = titleOp && titleOp.text !== undefined ? titleOp.text : undefined;
  return {
    targetId: tx.targetId,
    label: tx.label,
    before,
    after,
    diff,
    added: diff.filter((d) => d.kind === "added").length,
    removed: diff.filter((d) => d.kind === "removed").length,
    titleBefore: titleAfter !== undefined ? target.title ?? "" : undefined,
    titleAfter,
  };
}

/** Which app surface owns each editable Cardspoke shape, for proposals. */
const APP_FOR_TARGET: Partial<Record<ObjectType, AppId>> = {
  document: "writer",
  card: "cards",
  task: "tasks",
  memory: "assistant",
};

/**
 * Route an AI edit through the broker: the transaction becomes an
 * ActionProposal whose effect is the fully-computed result, so the user can
 * inspect exactly what would change (the Approvals panel renders the line
 * diff) before approving. The effect carries baseUpdatedAt: if the document
 * changes between propose and approve, execution fails instead of clobbering.
 */
export async function proposeEditTransaction(
  tx: EditTransaction,
): Promise<ActionProposal | null> {
  const target = getObject(tx.targetId);
  if (!target) return null;
  // Ownership/policy identity is derived from the target's type, never supplied
  // by the caller — an app cannot propose an edit under another app's identity,
  // and a target type Editor Core does not own (file/project have no editable
  // body here) is rejected instead of silently proposed as the Writer.
  const app = APP_FOR_TARGET[target.type];
  if (!app) {
    record({
      type: "system.event",
      summary: `Editor Core: transaction rejected — ${target.type} objects are not editable through Editor Core`,
    });
    return null;
  }
  let nextBody: string;
  try {
    nextBody = applyOpsToText(target.body ?? "", tx.ops.filter((o) => o.kind !== "set-title"));
  } catch (err) {
    record({
      type: "system.event",
      summary: `Editor Core: transaction rejected — ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
  const titleOp = tx.ops.find((o) => o.kind === "set-title");
  // Through AI Core, not straight to the Broker — every AI write traverses
  // AI Core → Security gate → Broker, and the proposal carries the verified
  // originCore ("editor") rather than an asserted one.
  const proposal = await proposeThroughCore("editor", {
    app,
    actionType: "editor.applyTransaction",
    summary: `${tx.label} — “${target.title || "Untitled"}”`,
    detail: `${tx.ops.length} structured edit operation${tx.ops.length === 1 ? "" : "s"} via Editor Core`,
    effect: {
      kind: "update",
      targetId: tx.targetId,
      // The monotonic version token (rev) is the stale-base check; updatedAt
      // rides along for display and for older persisted proposals.
      baseRev: target.rev ?? 0,
      baseUpdatedAt: target.updatedAt,
      payload: {
        body: nextBody,
        // set-title with empty text clears the title; absent op leaves it alone.
        ...(titleOp && titleOp.text !== undefined ? { title: titleOp.text } : {}),
      },
    },
  });
  // Only record a genuine proposal — a Security-denied proposal is not a
  // "transaction proposed" event (it never entered the queue as pending).
  if (proposal.status !== "denied") {
    record({
      type: "editor.transaction.proposed",
      app: proposal.app,
      summary: `Editor Core: transaction proposed — ${tx.label}`,
    });
  }
  return proposal;
}

/* ---------------------------------- export --------------------------------- */

/** Export text as a downloadable file. The one real export path in v1. */
export function exportAsFile(filename: string, text: string, mime = "text/markdown"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  record({ type: "editor.exported", summary: `Editor Core exported: ${filename}` });
}
