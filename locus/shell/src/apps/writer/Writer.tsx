/*
 * Writer — Markdown documents you own as plain text; the first Editor Core
 * proof (directive §7).
 * Multi-document and backed by the shared object store: every document is a
 * real SystemObject, so it appears in Search, links into Projects, and is
 * visible to the AI context layer. Editor Core supplies export and the AI
 * edit path: “Propose AI tidy” builds a structured edit transaction that
 * lands in the Approvals queue — the AI never edits invisibly.
 */

import { useMemo, useState } from "react";
import { useObjectsOfType } from "@/core/hooks";
import { createObject, updateObject, getObject } from "@/core/objects";
import { deleteCard } from "@/core/cores/cardspoke";
import {
  exportAsFile,
  proposeEditTransaction,
  transformText,
  createUndoStack,
  TEXT_TRANSFORMS,
  type TextTransform,
  type UndoStack,
} from "@/core/cores/editor";
import { renderMarkdown } from "./markdown";
import { Toolbar } from "@/components/ui";
import "./writer.css";

/** A deterministic local “tidy”: trim trailing spaces, collapse 3+ blank lines. */
function tidyOps(body: string) {
  const tidied = body.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  if (tidied === body) return null;
  return [{ kind: "replace-range" as const, at: 0, end: body.length, text: tidied }];
}

export default function Writer() {
  const docs = useObjectsOfType("document");
  const [selectedId, setSelectedId] = useState<string>("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [, bump] = useState(0);

  const selected = docs.find((d) => d.id === selectedId) ?? docs[0];
  const words = selected?.body?.trim() ? selected.body.trim().split(/\s+/).length : 0;

  // Editor Core's shared undo grammar, one stack per open document. Tracks
  // Transform-menu operations (typing has the browser's own undo).
  const undoStack: UndoStack<string> | null = useMemo(
    () => (selected ? createUndoStack<string>(selected.body ?? "") : null),
    // A new stack per document identity — not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected?.id],
  );

  function newDoc() {
    const doc = createObject({
      type: "document",
      title: "Untitled",
      body: "# Untitled\n\n",
    });
    setSelectedId(doc.id);
    setMode("write");
  }

  function patch(p: { title?: string; body?: string }) {
    if (selected) updateObject(selected.id, p);
  }

  function applyTransform(t: TextTransform) {
    if (!selected || !undoStack) return;
    const before = selected.body ?? "";
    undoStack.push(before);
    const after = transformText(before, t);
    undoStack.push(after);
    patch({ body: after });
    bump((n) => n + 1);
  }

  function undoTransform() {
    if (!undoStack) return;
    const prev = undoStack.undo();
    if (prev !== null) {
      patch({ body: prev });
      bump((n) => n + 1);
    }
  }

  function redoTransform() {
    if (!undoStack) return;
    const next = undoStack.redo();
    if (next !== null) {
      patch({ body: next });
      bump((n) => n + 1);
    }
  }

  return (
    <div className="writer writer--multi">
      <aside className="writer__docs">
        <Toolbar>
          <button className="btn btn--primary btn--sm" onClick={newDoc}>+ New</button>
          <span className="mono faint">{docs.length}</span>
        </Toolbar>
        <ul className="writer__doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                className={`writer__doc ${d.id === selected?.id ? "is-active" : ""}`}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="writer__doc-title">{d.title || "Untitled"}</span>
                {d.projectIds[0] && (
                  <span className="chip writer__doc-project">
                    {getObject(d.projectIds[0])?.title ?? "project"}
                  </span>
                )}
              </button>
            </li>
          ))}
          {docs.length === 0 && <li className="faint writer__empty">No documents.</li>}
        </ul>
      </aside>

      <div className="writer__editor">
        {selected ? (
          <>
            <Toolbar>
              <div className="writer__tabs" role="tablist" aria-label="Editor mode">
                <button
                  role="tab"
                  aria-selected={mode === "write"}
                  className={`writer__tab ${mode === "write" ? "is-active" : ""}`}
                  onClick={() => setMode("write")}
                >
                  Write
                </button>
                <button
                  role="tab"
                  aria-selected={mode === "preview"}
                  className={`writer__tab ${mode === "preview" ? "is-active" : ""}`}
                  onClick={() => setMode("preview")}
                >
                  Preview
                </button>
              </div>
              <span className="mono faint writer__count">{words} words</span>
              <select
                className="field writer__transform"
                value=""
                onChange={(e) => {
                  if (e.target.value) applyTransform(e.target.value as TextTransform);
                }}
                aria-label="Transform text (Editor Core)"
                title="Editor Core's shared transformations, applied to the whole document"
              >
                <option value="" disabled>Transform…</option>
                {TEXT_TRANSFORMS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <button
                className="btn btn--ghost btn--sm"
                disabled={!undoStack?.canUndo()}
                onClick={undoTransform}
                title="Undo the last transform (Editor Core undo stack)"
              >
                ↩
              </button>
              <button
                className="btn btn--ghost btn--sm"
                disabled={!undoStack?.canRedo()}
                onClick={redoTransform}
                title="Redo (Editor Core undo stack)"
              >
                ↪
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  exportAsFile(`${(selected.title || "untitled").replace(/[^\w-]+/g, "-")}.md`, selected.body ?? "")
                }
                title="Export as Markdown via Editor Core"
              >
                Export .md
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  const ops = tidyOps(selected.body ?? "");
                  if (!ops) return;
                  proposeEditTransaction({ targetId: selected.id, label: "Tidy whitespace", ops });
                }}
                title="Builds an Editor Core edit transaction — review it in AI Assistant → Approvals"
              >
                Propose AI tidy
              </button>
              <button
                className="btn btn--ghost btn--sm writer__del"
                onClick={() => {
                  deleteCard(selected.id); // recoverable trash, not a hard delete
                  setSelectedId("");
                }}
                title="Moves the document to the trash (restorable in Cards → Trash)"
              >
                Delete
              </button>
            </Toolbar>

            <input
              className="writer__title"
              value={selected.title}
              onChange={(e) => patch({ title: e.target.value })}
              aria-label="Document title"
              placeholder="Untitled"
            />

            {mode === "write" ? (
              <textarea
                className="writer__body field"
                value={selected.body ?? ""}
                onChange={(e) => patch({ body: e.target.value })}
                aria-label="Document body (Markdown)"
                spellCheck
              />
            ) : (
              <article className="writer__preview">{renderMarkdown(selected.body ?? "")}</article>
            )}
          </>
        ) : (
          <div className="writer__blank faint">
            <p>No document open.</p>
            <button className="btn btn--primary btn--sm" onClick={newDoc}>
              Create your first document
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
