/*
 * List-shaped tiles: To-do, Notes, Files, Notifications.
 * ---------------------------------------------------------------------------
 * To-do is the lightweight personal quick list (deliberately separate from the
 * Task Manager, which is the system monitor). Notes is one always-there note.
 * Files shows recents small and hands to the Files app in Focus. Notifications
 * is the inbox for the Notification Center store.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import type { TileProps } from "./registry";
import { useShell } from "@/core/shell";
import { useStoredValue, useObjects, useNow } from "@/core/hooks";
import { StoreKeys } from "@/core/storage";
import { listFiles } from "@/core/cores/files";
import {
  getNotifications,
  unreadCount,
  isHeld,
  markAllRead,
  dismiss,
  clearNotifications,
  subscribeNotifications,
  groupBySource,
  type Notification,
  type NotificationAction,
} from "@/core/cores/notification";
import { snoozeEntry, formatTime } from "@/core/cores/time";
import { focusApp } from "@/core/desktop";

/* ---------------------------------- To-do ---------------------------------- */

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export function TodoTile({ size }: TileProps) {
  const [items, setItems] = useStoredValue<TodoItem[]>(StoreKeys.todoItems, []);
  const [draft, setDraft] = useState("");
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setItems([{ id: `td-${Date.now().toString(36)}`, text, done: false, createdAt: Date.now() }, ...items]);
    setDraft("");
  }
  function toggle(id: string) {
    setItems(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">{open.length}</span>
        <span className="faint">open item{open.length === 1 ? "" : "s"}</span>
      </div>
    );
  }

  const visible = size === "small" ? open.slice(0, 3) : size === "medium" ? open.slice(0, 8) : open;

  return (
    <div className="tilec todo">
      <form className="tilec__inline-form" onSubmit={add}>
        <input
          className="field"
          placeholder="Add an item…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="New to-do item"
        />
      </form>
      <ul className="todo__list">
        {visible.map((i) => (
          <li key={i.id} className="todo__item">
            <label className="todo__label">
              <input type="checkbox" checked={i.done} onChange={() => toggle(i.id)} />
              <span>{i.text}</span>
            </label>
          </li>
        ))}
        {open.length === 0 && <li className="faint todo__empty">All clear.</li>}
        {size === "small" && open.length > visible.length && (
          <li className="faint">+{open.length - visible.length} more</li>
        )}
      </ul>
      {size === "large" && done.length > 0 && (
        <>
          <p className="eyebrow">Done · {done.length}</p>
          <ul className="todo__list todo__list--done">
            {done.slice(0, 10).map((i) => (
              <li key={i.id} className="todo__item">
                <label className="todo__label">
                  <input type="checkbox" checked onChange={() => toggle(i.id)} />
                  <span className="todo__done-text">{i.text}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className="tilec__link" onClick={() => setItems(open)}>Clear completed</button>
        </>
      )}
    </div>
  );
}

/* ---------------------------------- Notes ---------------------------------- */

export function NotesTile({ size }: TileProps) {
  const { openApp } = useShell();
  const [note, setNote] = useStoredValue<string>(StoreKeys.quickNote, "");

  if (size === "tiny") {
    const first = note.split("\n").find((l) => l.trim()) ?? "";
    return (
      <div className="tilec tilec--center">
        {first ? <span className="notes__peek">{first}</span> : <span className="faint">Empty note</span>}
      </div>
    );
  }
  return (
    <div className="tilec notes">
      <textarea
        className="notes__area"
        placeholder="Jot something down — it stays right here."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Quick note"
      />
      {size === "large" && (
        <p className="faint tilec__hint">
          Saved as you type ·{" "}
          <button className="tilec__link" onClick={() => openApp("writer")}>
            open Writer for documents
          </button>
        </p>
      )}
    </div>
  );
}

/* ---------------------------------- Files ---------------------------------- */

export function FilesTile({ size }: TileProps) {
  const { openApp } = useShell();
  // Through Files Core, not the raw object store — trashed files must not
  // resurface on the dashboard.
  const all = useObjects();
  const files = useMemo(() => listFiles(), [all]);
  const recent = useMemo(
    () => [...files].sort((a, b) => b.updatedAt - a.updatedAt),
    [files],
  );

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono" aria-hidden>▚</span>
        <span className="faint">{files.length} file{files.length === 1 ? "" : "s"}</span>
      </div>
    );
  }

  const count = size === "small" ? 4 : size === "medium" ? 8 : 14;
  return (
    <div className="tilec files">
      <ul className="files__list">
        {recent.slice(0, count).map((f) => (
          <li key={f.id} className="files__row">
            <span className="mono faint" aria-hidden>▚</span>
            <span className="files__name">{f.title}</span>
            {size !== "small" && (
              <span className="faint mono files__meta">
                {f.file?.kind ?? "file"}
              </span>
            )}
          </li>
        ))}
        {recent.length === 0 && <li className="faint">No files yet. Connect a source to index files.</li>}
      </ul>
      {(size === "medium" || size === "large") && (
        <button className="tilec__link" onClick={() => openApp("files")}>
          Open the full file browser →
        </button>
      )}
    </div>
  );
}

/* ------------------------------ Notifications ------------------------------ */

/** Service a notification's declarative action buttons. */
function runAction(a: NotificationAction): void {
  if (a.kind === "open-app" && a.appId) focusApp(a.appId);
  if (a.kind === "snooze-entry" && a.entryId) snoozeEntry(a.entryId, a.minutes ?? 10);
}

function NotifRow({ n, size }: { n: Notification; size: TileProps["size"] }) {
  const held = isHeld(n);
  return (
    <li className={`notif__row ${n.read ? "is-read" : ""} ${held ? "is-held" : ""}`}>
      <span className={`dot ${n.read || held ? "dot--off" : "dot--on"}`} aria-hidden />
      <span className="notif__body">
        <span className="notif__title">{n.title}</span>
        {n.detail && size !== "small" && <span className="faint notif__detail">{n.detail}</span>}
        <span className="faint mono notif__meta">
          {n.source} · {formatTime(n.at)}
          {held && " · held (quiet hours)"}
        </span>
        {n.actions && n.actions.length > 0 && size !== "small" && (
          <span className="notif__rowactions">
            {n.actions.map((a) => (
              <button key={a.label} className="tilec__link" onClick={() => runAction(a)}>
                {a.label}
              </button>
            ))}
          </span>
        )}
      </span>
      {size === "large" && (
        <button className="tilec__link" onClick={() => dismiss(n.id)} aria-label={`Dismiss ${n.title}`}>
          ×
        </button>
      )}
    </li>
  );
}

export function NotificationsTile({ size }: TileProps) {
  const items = useSyncExternalStore(subscribeNotifications, getNotifications);
  // Re-render each minute so held items surface the moment their hold ends.
  useNow(60_000);
  const unread = unreadCount();

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">{unread}</span>
        <span className="faint">unread</span>
      </div>
    );
  }

  const count = size === "small" ? 3 : size === "medium" ? 6 : 20;

  // The large size groups by source (Notification Core's grouping view).
  if (size === "large") {
    const groups = groupBySource();
    return (
      <div className="tilec notif">
        <ul className="notif__list">
          {groups.map((g) => (
            <li key={g.source} className="notif__group">
              <p className="eyebrow notif__grouphead">{g.source}</p>
              <ul className="notif__list">
                {g.items.slice(0, 6).map((n) => (
                  <NotifRow key={n.id} n={n} size={size} />
                ))}
              </ul>
            </li>
          ))}
          {items.length === 0 && <li className="faint">Nothing to report. Notifications appear here.</li>}
        </ul>
        {items.length > 0 && (
          <p className="notif__actions">
            {unread > 0 && (
              <button className="tilec__link" onClick={markAllRead}>Mark all read</button>
            )}
            <button className="tilec__link" onClick={clearNotifications}>Clear</button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="tilec notif">
      <ul className="notif__list">
        {items.slice(0, count).map((n) => (
          <NotifRow key={n.id} n={n} size={size} />
        ))}
        {items.length === 0 && <li className="faint">Nothing to report. Notifications appear here.</li>}
      </ul>
      {items.length > 0 && size !== "small" && (
        <p className="notif__actions">
          {unread > 0 && (
            <button className="tilec__link" onClick={markAllRead}>Mark all read</button>
          )}
          <button className="tilec__link" onClick={clearNotifications}>Clear</button>
        </p>
      )}
    </div>
  );
}
