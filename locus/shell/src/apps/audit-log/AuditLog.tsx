/*
 * Audit Log — every system and AI action, on the record (functional).
 * Reads the live local log and filters by category. The log is append-only:
 * "clearing" archives the visible window (nothing is erased in one call),
 * and events that scroll past the live window spill into the same archive.
 */

import { useState, useSyncExternalStore } from "react";
import { getEvents, getArchivedEvents, subscribe, archiveEvents } from "@/core/audit";
import { getApp } from "@/core/appRegistry";
import { Toolbar, FutureNote, Section } from "@/components/ui";
import type { AuditEvent, AuditEventType } from "@/types";
import "./audit-log.css";

const FILTERS: { id: "all" | "ai" | "permission" | "object" | "system"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ai", label: "AI" },
  { id: "permission", label: "Permissions" },
  { id: "object", label: "Objects" },
  { id: "system", label: "System" },
];

function matches(type: AuditEventType, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "permission") return type === "permission.changed";
  if (filter === "system") return type === "system.event" || type === "setting.changed";
  return type.startsWith(`${filter}.`);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AuditLog() {
  const events = useSyncExternalStore(subscribe, getEvents);
  const [filter, setFilter] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const archivedCount = getArchivedEvents().length;

  const visible = events.filter((e) => matches(e.type, filter));

  return (
    <div className="audit">
      <Toolbar>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`btn btn--sm ${filter === f.id ? "btn--primary" : "btn--ghost"}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span style={{ marginLeft: "auto" }}>
          {archivedCount > 0 && (
            <span className="mono faint audit__archived">{archivedCount} archived · </span>
          )}
          {confirmClear ? (
            <span className="audit__confirm">
              <button className="btn btn--sm" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button
                className="btn btn--sm audit__danger"
                onClick={() => { archiveEvents(); setConfirmClear(false); }}
                title="The log is append-only: this archives the visible window, it does not erase it"
              >
                Archive log
              </button>
            </span>
          ) : (
            <button className="btn btn--sm btn--ghost" onClick={() => setConfirmClear(true)}>Archive…</button>
          )}
        </span>
      </Toolbar>

      <ol className="audit__list">
        {visible.map((e) => (
          <AuditRow key={e.id} event={e} />
        ))}
        {visible.length === 0 && <li className="faint audit__empty">No events in this view.</li>}
      </ol>

      <Section title="About this app">
        <FutureNote
          items={[
            "Export the log as a signed, portable record",
            "Per-app and per-provider activity views",
            "Alerts when the AI attempts a forbidden action",
          ]}
        />
      </Section>
    </div>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const app = event.app ? getApp(event.app) : undefined;
  const kind = event.type.split(".")[1] ?? event.type;
  return (
    <li className={`audit__row audit__row--${event.severity}`}>
      <span className="audit__time mono faint">{timeAgo(event.timestamp)}</span>
      <span className={`audit__type mono audit__type--${kind}`}>{event.type}</span>
      <span className="audit__body">
        <span className="audit__summary">{event.summary}</span>
        {event.detail && <span className="faint audit__detail">{event.detail}</span>}
      </span>
      {app && <span className="chip audit__app">{app.name}</span>}
    </li>
  );
}
