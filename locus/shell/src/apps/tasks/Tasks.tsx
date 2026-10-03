/*
 * Tasks — a surface over Cardspoke Core (content) + Time Core (timing).
 * Tasks are real SystemObjects, so they show up in Search, link into Projects,
 * and are visible to the AI context layer. Add / toggle / filter / prioritize /
 * delete; everything persists locally and is auditable. Cross-core on purpose
 * (directive §19): due dates live on the card, reminders go through Time
 * Core, and Monitor Core's task-deadline watch alerts when something slips.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { useObjectsOfType } from "@/core/hooks";
import { getObject } from "@/core/objects";
import {
  createCard,
  setCardDue,
  setCardStatus,
  setCardPriority,
  deleteCard,
  listSavedFilters,
  subscribeSavedFilters,
  saveFilter,
  removeSavedFilter,
  type NamedFilter,
} from "@/core/cores/cardspoke";
import { createReminder, todayLocal } from "@/core/cores/time";
import { createWatch, listWatches } from "@/core/cores/monitor";
import type { SystemObject, TaskPriority } from "@/types";
import { Section, FutureNote, Toolbar } from "@/components/ui";
import "./tasks.css";

// Local calendar day from Time Core (F2) — no UTC "overdue at 5pm" chips.
const TODAY = todayLocal;

/** Remind at 9:00 on the due date (or now+1min if that is already past). */
function reminderTimeFor(due: string): number {
  const at = new Date(`${due}T09:00:00`).getTime();
  return at > Date.now() ? at : Date.now() + 60_000;
}

type Filter = "all" | "open" | "done";

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

export default function Tasks() {
  const tasks = useObjectsOfType("task");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const savedFilters = useSyncExternalStore(subscribeSavedFilters, listSavedFilters);

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const ad = a.task?.done ? 1 : 0;
        const bd = b.task?.done ? 1 : 0;
        if (ad !== bd) return ad - bd;
        return (
          PRIORITY_ORDER[a.task?.priority ?? "normal"] -
          PRIORITY_ORDER[b.task?.priority ?? "normal"]
        );
      }),
    [tasks],
  );

  const tag = tagFilter.trim().replace(/^#/, "").toLowerCase();
  const visible = sorted.filter((t) => {
    if (filter === "open" && t.task?.done) return false;
    if (filter === "done" && !t.task?.done) return false;
    if (tag && !t.tags.some((x) => x.toLowerCase() === tag)) return false;
    return true;
  });
  const openCount = tasks.filter((t) => !t.task?.done).length;

  function applySavedFilter(f: NamedFilter) {
    setFilter(f.done === true ? "done" : f.done === false ? "open" : "all");
    setTagFilter(f.tag ?? "");
  }

  function saveCurrentFilter() {
    const name = window.prompt("Name this filter", tag ? `#${tag}` : filter);
    if (!name) return;
    saveFilter(name, {
      type: "task",
      done: filter === "all" ? undefined : filter === "done",
      tag: tag || undefined,
    });
  }

  function add() {
    const title = draft.trim();
    if (!title) return;
    // Task creation goes through Cardspoke Core (inline #tags included).
    createCard({ type: "task", title });
    setDraft("");
  }

  // Status and priority go through Cardspoke Core — the Core owns task
  // mutation semantics; the app is only a surface.
  function toggle(t: SystemObject) {
    setCardStatus(t.id, !t.task!.done);
  }

  function cyclePriority(t: SystemObject) {
    const order: TaskPriority[] = ["normal", "high", "low"];
    const next = order[(order.indexOf(t.task!.priority) + 1) % order.length];
    setCardPriority(t.id, next);
  }

  return (
    <div className="tasks">
      <div className="tasks__add">
        <input
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a task and press Enter"
          aria-label="New task"
        />
        <button className="btn btn--primary" onClick={add}>Add</button>
      </div>

      <Toolbar>
        {(["all", "open", "done"] as Filter[]).map((f) => (
          <button
            key={f}
            className={`btn btn--sm ${filter === f ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
        <input
          className="field"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="#tag"
          aria-label="Filter by tag"
          style={{ width: "8rem" }}
        />
        <button className="btn btn--ghost btn--sm" onClick={saveCurrentFilter} title="Save this filter (Cardspoke Core saved filters)">
          Save filter
        </button>
        <span className="mono faint" style={{ marginLeft: "auto" }}>
          {openCount} open
        </span>
      </Toolbar>

      {savedFilters.length > 0 && (
        <Toolbar>
          <span className="faint mono">Saved:</span>
          {savedFilters.map((f) => (
            <span key={f.id} className="chip">
              <button className="tasks__prio" onClick={() => applySavedFilter(f)}>
                {f.name}
              </button>{" "}
              <button
                className="tasks__del"
                onClick={() => removeSavedFilter(f.id)}
                aria-label={`Remove saved filter ${f.name}`}
                title="Remove saved filter"
              >
                ✕
              </button>
            </span>
          ))}
        </Toolbar>
      )}

      <ul className="tasks__list">
        {visible.map((t) => (
          <li key={t.id} className="tasks__item">
            <label className="tasks__check">
              <input
                type="checkbox"
                checked={!!t.task?.done}
                onChange={() => toggle(t)}
                aria-label={t.title}
              />
              <span className={t.task?.done ? "tasks__title is-done" : "tasks__title"}>
                {t.title}
              </span>
            </label>
            <span className="tasks__meta">
              {t.projectIds[0] && (
                <span className="chip tasks__project">
                  {getObject(t.projectIds[0])?.title ?? "project"}
                </span>
              )}
              <input
                className="field tasks__due"
                type="date"
                value={t.task?.due ?? ""}
                onChange={(e) => setCardDue(t.id, e.target.value || undefined)}
                aria-label={`Due date for ${t.title}`}
                title="Due date (Cardspoke Core field; Monitor Core watches overdue)"
              />
              {t.task?.due && !t.task.done && t.task.due < TODAY() && (
                <span className="tasks__overdue mono">overdue</span>
              )}
              {t.task?.due && !t.task.done && (
                <button
                  className="tasks__remind"
                  onClick={() => createReminder(`Task due: ${t.title}`, reminderTimeFor(t.task!.due!), "tasks")}
                  title="Create a reminder in Time Core for the morning it is due"
                >
                  ⏰
                </button>
              )}
              <button
                className={`tasks__prio tasks__prio--${t.task?.priority ?? "normal"}`}
                onClick={() => cyclePriority(t)}
                title="Cycle priority"
                aria-label={`Priority: ${t.task?.priority ?? "normal"}`}
              >
                {t.task?.priority ?? "normal"}
              </button>
              <button
                className="tasks__del"
                onClick={() => {
                  if (window.confirm(`Delete task “${t.title}”? This cannot be undone.`)) {
                    deleteCard(t.id);
                  }
                }}
                aria-label={`Delete ${t.title}`}
                title="Delete task (permanent)"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
        {visible.length === 0 && <li className="faint tasks__empty">Nothing here.</li>}
      </ul>

      {!listWatches().some((w) => w.type === "task-deadline") && tasks.some((t) => t.task?.due) && (
        <p className="tasks__hint faint">
          Cross-core:{" "}
          <button
            className="tasks__link"
            onClick={() => createWatch({ name: "Overdue tasks", type: "task-deadline" })}
          >
            let Monitor watch for overdue tasks
          </button>{" "}
          — alerts arrive through Notifications.
        </p>
      )}

      <Section title="About this app">
        <FutureNote
          items={[
            "Recurring tasks through Time Core recurrence",
            "AI breakdown of a big task into steps — proposed for your approval",
          ]}
        />
      </Section>
    </div>
  );
}
