/*
 * Anchor previews — the compact live views shown inside AnchorTiles.
 * Each is a small, read-only glance at an app's real state (from the object
 * store), so the spatial desktop shows genuine information at rest, not fake
 * dashboard filler. Expanding an Anchor opens the full app in the FocusSurface.
 */

import { useMemo } from "react";
import { useObjectsOfType } from "@/core/hooks";
import "./previews.css";

export function TasksPreview() {
  const tasks = useObjectsOfType("task");
  const open = tasks.filter((t) => !t.task?.done);
  const top = useMemo(
    () =>
      [...open].sort(
        (a, b) =>
          (a.task?.priority === "high" ? 0 : 1) - (b.task?.priority === "high" ? 0 : 1),
      ).slice(0, 4),
    [open],
  );
  return (
    <div className="preview">
      <p className="preview__lead mono">{open.length} open</p>
      <ul className="preview__list">
        {top.map((t) => (
          <li key={t.id} className="preview__row">
            <span className="preview__dot" aria-hidden />
            <span className="preview__text">{t.title}</span>
          </li>
        ))}
        {top.length === 0 && <li className="faint preview__empty">All clear.</li>}
      </ul>
    </div>
  );
}

export function WriterPreview() {
  const docs = useObjectsOfType("document");
  const recent = useMemo(
    () => [...docs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [docs],
  );
  return (
    <div className="preview">
      <p className="preview__lead mono">{docs.length} docs</p>
      <ul className="preview__list">
        {recent.map((d) => (
          <li key={d.id} className="preview__row">
            <span className="mono faint" aria-hidden>≡</span>
            <span className="preview__text">{d.title || "Untitled"}</span>
          </li>
        ))}
        {recent.length === 0 && <li className="faint preview__empty">No documents.</li>}
      </ul>
    </div>
  );
}

export function CardsPreview() {
  const cards = useObjectsOfType("card");
  const recent = useMemo(
    () => [...cards].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [cards],
  );
  return (
    <div className="preview">
      <p className="preview__lead mono">{cards.length} cards</p>
      <ul className="preview__list">
        {recent.map((c) => (
          <li key={c.id} className="preview__row">
            <span className="mono faint" aria-hidden>▢</span>
            <span className="preview__text">{c.title || "Untitled"}</span>
          </li>
        ))}
        {recent.length === 0 && <li className="faint preview__empty">No cards.</li>}
      </ul>
    </div>
  );
}

export function FilesPreview() {
  const files = useObjectsOfType("file");
  const recent = useMemo(
    () => [...files].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [files],
  );
  return (
    <div className="preview">
      <p className="preview__lead mono">{files.length} files</p>
      <ul className="preview__list">
        {recent.map((f) => (
          <li key={f.id} className="preview__row">
            <span className="mono faint" aria-hidden>▚</span>
            <span className="preview__text">{f.title}</span>
          </li>
        ))}
        {recent.length === 0 && <li className="faint preview__empty">No files.</li>}
      </ul>
    </div>
  );
}

export function SearchPreview() {
  return (
    <div className="preview preview--center">
      <span className="preview__glyph mono" aria-hidden>⌕</span>
      <p className="faint preview__hint">Search everything you own.</p>
    </div>
  );
}
