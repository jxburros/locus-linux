/*
 * Monitor — the user-facing view over Monitor Core (directive §11).
 * All watches with live status, pause/resume (a mute, not a reset), edit,
 * delete, a create form with severity and frequency, suggested watches drawn
 * from what actually exists, and the recent trigger history. Alerts flow
 * through Notification Core; every trigger is on the audit record. The
 * evaluator itself runs as a job on Time Core's one scheduler.
 */

import { useState, useSyncExternalStore } from "react";
import {
  listWatches,
  watchEvents,
  subscribeWatches,
  subscribeWatchEvents,
  createWatch,
  updateWatch,
  setWatchEnabled,
  deleteWatch,
  checkAllNow,
  suggestedWatches,
  lastCheckedAt,
  type WatchType,
  type WatchSeverity,
  type Watch,
} from "@/core/cores/monitor";
import { useObjectsOfType, useNow } from "@/core/hooks";
import { formatDateTime } from "@/core/cores/time";
import { Section, FutureNote, Toolbar, EmptyState } from "@/components/ui";
import "./monitor.css";

const TYPE_LABELS: Record<WatchType, string> = {
  storage: "Storage usage",
  "task-deadline": "Task deadlines",
  "file-change": "Object changes",
  "stale-item": "Stale item",
  "contact-cadence": "Contact follow-up",
  webpage: "Webpage reachability",
};

const FREQUENCIES: { label: string; ms: number }[] = [
  { label: "every minute", ms: 60_000 },
  { label: "every 5 min", ms: 5 * 60_000 },
  { label: "every 30 min", ms: 30 * 60_000 },
  { label: "hourly", ms: 60 * 60_000 },
];

function StatusDot({ status, paused }: { status: Watch["status"]; paused?: boolean }) {
  const shown = paused ? "paused" : status;
  return <span className={`monitor__dot monitor__dot--${shown}`} title={shown} aria-label={shown} />;
}

function EditRow({ watch, onDone }: { watch: Watch; onDone: () => void }) {
  const [name, setName] = useState(watch.name);
  const [severity, setSeverity] = useState<WatchSeverity>(watch.severity);
  const [frequencyMs, setFrequencyMs] = useState(watch.frequencyMs);
  const [days, setDays] = useState(watch.params.days ?? watch.params.staleDays ?? 30);

  function save() {
    updateWatch(watch.id, {
      name: name.trim() || watch.name,
      severity,
      frequencyMs,
      params:
        watch.type === "contact-cadence"
          ? { days }
          : watch.type === "stale-item"
            ? { staleDays: days }
            : {},
    });
    onDone();
  }

  return (
    <div className="monitor__edit">
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} aria-label="Watch name" />
      <select className="field" value={severity} onChange={(e) => setSeverity(e.target.value as WatchSeverity)} aria-label="Severity">
        {(["info", "warning", "critical"] as WatchSeverity[]).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select className="field" value={frequencyMs} onChange={(e) => setFrequencyMs(Number(e.target.value))} aria-label="Check frequency">
        {FREQUENCIES.map((f) => (
          <option key={f.ms} value={f.ms}>{f.label}</option>
        ))}
      </select>
      {(watch.type === "contact-cadence" || watch.type === "stale-item") && (
        <label className="monitor__days">
          after
          <input className="field" type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} />
          days
        </label>
      )}
      <button className="btn btn--sm btn--primary" onClick={save}>Save</button>
      <button className="btn btn--sm btn--ghost" onClick={onDone}>Cancel</button>
    </div>
  );
}

export default function Monitor() {
  useSyncExternalStore(subscribeWatches, listWatches);
  useSyncExternalStore(subscribeWatchEvents, watchEvents);
  useNow(15_000); // refresh the volatile "checked …" column
  const watches = listWatches();
  const events = watchEvents().slice(0, 10);
  const suggestions = suggestedWatches();
  const documents = useObjectsOfType("document");

  const [name, setName] = useState("");
  const [type, setType] = useState<WatchType>("storage");
  const [objectId, setObjectId] = useState("");
  const [days, setDays] = useState(30);
  const [url, setUrl] = useState("");
  const [severity, setSeverity] = useState<WatchSeverity>("warning");
  const [frequencyMs, setFrequencyMs] = useState(60_000);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      createWatch({
        name: name.trim(),
        type,
        severity,
        frequencyMs,
        params:
          type === "file-change"
            ? { objectId: objectId || documents[0]?.id }
            : type === "stale-item"
              ? { objectId: objectId || documents[0]?.id, staleDays: days }
              : type === "contact-cadence"
                ? { days }
                : type === "webpage"
                  ? { url, checkEnabled: true }
                  : {},
      });
      setName("");
      setFormError("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="monitor">
      <Toolbar>
        <span className="mono faint">
          {watches.filter((w) => w.status === "warning" || w.status === "critical").length} alerting ·{" "}
          {watches.length} watch{watches.length === 1 ? "" : "es"}
        </span>
        <button className="btn btn--sm" style={{ marginLeft: "auto" }} onClick={checkAllNow}>
          Check all now
        </button>
      </Toolbar>

      <Section title="Watches">
        {watches.length === 0 ? (
          <EmptyState
            title="Nothing is being watched"
            hint="Create a watch below, or start from a suggestion — Monitor alerts you when something changes, breaks, or goes stale."
          />
        ) : (
          <ul className="monitor__list">
            {watches.map((w) => (
              <li key={w.id} className="monitor__watch">
                <StatusDot status={w.status} paused={!w.enabled} />
                <span className="monitor__wname">
                  {w.name}
                  <span className="faint monitor__wtype"> · {TYPE_LABELS[w.type]}</span>
                  {w.createdBy !== "user" && <span className="chip">{w.createdBy}</span>}
                  {w.status === "missing" && <span className="chip">target gone</span>}
                </span>
                <span className="mono faint monitor__wmeta">
                  {w.type === "webpage" && !w.params.checkEnabled
                    ? "defined — enable checks to evaluate"
                    : lastCheckedAt(w.id)
                      ? `checked ${formatDateTime(lastCheckedAt(w.id)!)}`
                      : "not yet checked"}
                </span>
                <button className="btn btn--ghost btn--sm" onClick={() => setEditingId(editingId === w.id ? "" : w.id)}>
                  Edit
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setWatchEnabled(w.id, !w.enabled)}>
                  {w.enabled ? "Pause" : "Resume"}
                </button>
                <button className="monitor__x" onClick={() => deleteWatch(w.id)} aria-label={`Delete ${w.name}`}>
                  ✕
                </button>
                {w.lastEvent && (
                  <span className="monitor__event faint">{w.lastEvent}</span>
                )}
                {editingId === w.id && (
                  <EditRow watch={w} onDone={() => setEditingId("")} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {suggestions.length > 0 && (
        <Section title="Suggested watches">
          <ul className="monitor__suggestions">
            {suggestions.map((s) => (
              <li key={s.name} className="monitor__suggestion">
                <span className="monitor__sname">{s.name}</span>
                <span className="faint monitor__sreason">{s.reason}</span>
                <button
                  className="btn btn--sm"
                  onClick={() => createWatch({ name: s.name, type: s.type, params: s.params })}
                >
                  Watch
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="New watch">
        <form className="monitor__add" onSubmit={add}>
          <input
            className="field monitor__grow"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Watch name"
            aria-label="Watch name"
          />
          <select className="field" value={type} onChange={(e) => setType(e.target.value as WatchType)} aria-label="Watch type">
            {(Object.keys(TYPE_LABELS) as WatchType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <select className="field" value={severity} onChange={(e) => setSeverity(e.target.value as WatchSeverity)} aria-label="Severity">
            {(["info", "warning", "critical"] as WatchSeverity[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="field" value={frequencyMs} onChange={(e) => setFrequencyMs(Number(e.target.value))} aria-label="Check frequency">
            {FREQUENCIES.map((f) => (
              <option key={f.ms} value={f.ms}>{f.label}</option>
            ))}
          </select>
          {(type === "file-change" || type === "stale-item") && (
            <select className="field" value={objectId} onChange={(e) => setObjectId(e.target.value)} aria-label="Object to watch">
              {documents.map((d) => (
                <option key={d.id} value={d.id}>{d.title || "Untitled"}</option>
              ))}
            </select>
          )}
          {(type === "contact-cadence" || type === "stale-item") && (
            <label className="monitor__days">
              alert after
              <input
                className="field"
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 30)}
                aria-label={type === "stale-item" ? "Days without change" : "Days without contact"}
              />
              days
            </label>
          )}
          {type === "webpage" && (
            <input
              className="field monitor__grow"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              aria-label="Page URL"
            />
          )}
          <button className="btn btn--primary" type="submit">Create</button>
        </form>
        {formError && <p className="monitor__formerror mono">{formError}</p>}
      </Section>

      <Section title="Recent triggers">
        {events.length === 0 ? (
          <p className="faint">No triggers yet. When a watch fires, it lands here, in Notifications, and in the Audit Log.</p>
        ) : (
          <ul className="monitor__events">
            {events.map((e) => (
              <li key={e.id} className="monitor__eventrow">
                <StatusDot status={e.status} />
                <span className="monitor__wname">{e.watchName}</span>
                <span className="faint monitor__grow">{e.message}</span>
                <span className="mono faint">{formatDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="About this app">
        <FutureNote
          items={[
            "Page content-change watches once an embedded engine exists",
            "Device health: CPU, memory, temperature, battery wear",
            "“Monitor this” on every file, contact, task, and page",
            "Cooldowns and escalation are Core fields — a per-watch UI is next",
          ]}
        />
      </Section>
    </div>
  );
}
