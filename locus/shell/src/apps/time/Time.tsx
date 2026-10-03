/*
 * Time — the user-facing view over Time Core (directive §5).
 * Today, alarms, timers, a stopwatch, events, and reminders. The app owns no
 * timing logic: everything is a Time Core entry fired by the shared
 * scheduler, delivered through Notification Core, and recorded in the audit
 * log. The clock tile, Tasks reminders, and Monitor schedules all read the
 * same Core.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { useNow, useStoredValue } from "@/core/hooks";
import { StoreKeys } from "@/core/storage";
import {
  getTimeEntries,
  subscribeTime,
  upcomingEntries,
  firedEntries,
  createAlarm,
  createTimer,
  createEvent,
  createReminder,
  cancelTimeEntry,
  snoozeEntry,
  formatDateTime,
  formatTime,
  getHourCycle,
  setHourCycle,
  type HourCycle,
  type Recurrence,
  type TimeEntry,
} from "@/core/cores/time";
import { Section, FutureNote, Toolbar, EmptyState } from "@/components/ui";
import "./time.css";

const KIND_GLYPHS: Record<TimeEntry["kind"], string> = {
  alarm: "◷",
  timer: "◔",
  event: "▦",
  reminder: "◌",
  trigger: "⟳",
};

function nextAt(dateStr: string, timeStr: string): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  base.setHours(h, m, 0, 0);
  if (!dateStr && base.getTime() <= Date.now()) base.setDate(base.getDate() + 1);
  return base.getTime();
}

interface StopwatchState {
  running: boolean;
  /** Accumulated ms while stopped. */
  elapsed: number;
  /** Wall-clock start of the running span (absolute, so it survives reloads). */
  startedAt: number;
  laps: number[];
}

const STOPWATCH_INITIAL: StopwatchState = { running: false, elapsed: 0, startedAt: 0, laps: [] };

function Stopwatch() {
  // Persisted through storage: a running stopwatch survives unmount/reload.
  const [sw, setSw] = useStoredValue<StopwatchState>(StoreKeys.stopwatch, STOPWATCH_INITIAL);
  useNow(sw.running ? 100 : 3600_000); // re-render while running

  const nowElapsed = sw.running ? sw.elapsed + (Date.now() - sw.startedAt) : sw.elapsed;
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;
  };

  return (
    <div className="timeapp__stopwatch">
      <span className="timeapp__swtime mono">{fmt(nowElapsed)}</span>
      <span className="timeapp__swctl">
        {sw.running ? (
          <>
            <button className="btn btn--sm" onClick={() => setSw({ ...sw, laps: [nowElapsed, ...sw.laps] })}>Lap</button>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => setSw({ ...sw, elapsed: nowElapsed, running: false })}
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => setSw({ ...sw, startedAt: Date.now(), running: true })}
            >
              {sw.elapsed > 0 ? "Resume" : "Start"}
            </button>
            {sw.elapsed > 0 && (
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => setSw(STOPWATCH_INITIAL)}
              >
                Reset
              </button>
            )}
          </>
        )}
      </span>
      {sw.laps.length > 0 && (
        <ol className="timeapp__laps mono">
          {sw.laps.map((l, i) => (
            <li key={i}>{fmt(l)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Time() {
  useSyncExternalStore(subscribeTime, getTimeEntries);
  const now = useNow(1000);
  const hourCycle = getHourCycle();

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"alarm" | "event" | "reminder">("alarm");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [timerLabel, setTimerLabel] = useState("");

  const upcoming = upcomingEntries();
  const fired = firedEntries().slice(0, 6);
  const todayEnd = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);
  const today = upcoming.filter((e) => e.at <= todayEnd);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const at = nextAt(date, time);
    if (!at || !label.trim()) return;
    if (kind === "alarm") createAlarm(label.trim(), at, recurrence);
    if (kind === "event") createEvent(label.trim(), at, recurrence);
    if (kind === "reminder") createReminder(label.trim(), at);
    setLabel("");
    setTime("");
    setDate("");
  }

  function quickTimer(minutes: number) {
    createTimer(timerLabel.trim() || `${minutes} minute timer`, minutes * 60_000);
    setTimerLabel("");
  }

  return (
    <div className="timeapp">
      <div className="timeapp__nowrow">
        <span className="timeapp__now mono">{formatTime(now)}</span>
        <span className="muted">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
        <span style={{ marginLeft: "auto" }} className="timeapp__cycle">
          {(["auto", "12", "24"] as HourCycle[]).map((hc) => (
            <button
              key={hc}
              className={`btn btn--sm ${hourCycle === hc ? "btn--primary" : "btn--ghost"}`}
              onClick={() => setHourCycle(hc)}
              aria-pressed={hourCycle === hc}
            >
              {hc === "auto" ? "Auto" : `${hc}h`}
            </button>
          ))}
        </span>
      </div>

      <Section title="Today">
        {today.length === 0 ? (
          <p className="faint">Nothing scheduled for the rest of today.</p>
        ) : (
          <ul className="timeapp__list">
            {today.map((e) => (
              <li key={e.id} className="timeapp__entry">
                <span className="mono" aria-hidden>{KIND_GLYPHS[e.kind]}</span>
                <span className="timeapp__entry-label">{e.label}</span>
                <span className="mono faint">{formatTime(e.at)}</span>
                <button className="timeapp__x" onClick={() => cancelTimeEntry(e.id)} aria-label={`Cancel ${e.label}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="New alarm · event · reminder">
        <form className="timeapp__add" onSubmit={add}>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind">
            <option value="alarm">Alarm</option>
            <option value="event">Event</option>
            <option value="reminder">Reminder</option>
          </select>
          <input
            className="field timeapp__grow"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is it?"
            aria-label="Label"
          />
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date (optional — today/tomorrow if empty)" />
          <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" required />
          <select className="field" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)} aria-label="Repeats">
            <option value="none">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <button className="btn btn--primary" type="submit">Add</button>
        </form>
      </Section>

      <Section title="Timers">
        <Toolbar>
          <input
            className="field timeapp__grow"
            value={timerLabel}
            onChange={(e) => setTimerLabel(e.target.value)}
            placeholder="Timer label (optional)"
            aria-label="Timer label"
          />
          {[1, 5, 10, 25].map((m) => (
            <button key={m} className="btn btn--sm" onClick={() => quickTimer(m)}>
              {m} min
            </button>
          ))}
        </Toolbar>
        <ul className="timeapp__list">
          {upcoming
            .filter((e) => e.kind === "timer")
            .map((e) => (
              <li key={e.id} className="timeapp__entry">
                <span className="mono" aria-hidden>◔</span>
                <span className="timeapp__entry-label">{e.label}</span>
                <span className="mono faint">
                  {Math.max(0, Math.ceil((e.at - now.getTime()) / 1000))}s left
                </span>
                <button className="timeapp__x" onClick={() => cancelTimeEntry(e.id)} aria-label={`Cancel ${e.label}`}>✕</button>
              </li>
            ))}
        </ul>
      </Section>

      <Section title="Stopwatch">
        <Stopwatch />
      </Section>

      <Section title="Upcoming">
        {upcoming.filter((e) => e.kind !== "timer").length === 0 ? (
          <EmptyState title="Nothing scheduled" hint="Alarms, events, and reminders created anywhere in the OS appear here." />
        ) : (
          <ul className="timeapp__list">
            {upcoming
              .filter((e) => e.kind !== "timer")
              .slice(0, 12)
              .map((e) => (
                <li key={e.id} className="timeapp__entry">
                  <span className="mono" aria-hidden>{KIND_GLYPHS[e.kind]}</span>
                  <span className="timeapp__entry-label">
                    {e.label}
                    {e.source !== "user" && <span className="chip timeapp__src">{e.source}</span>}
                    {e.recurrence !== "none" && <span className="mono faint"> · {e.recurrence}</span>}
                  </span>
                  <span className="mono faint">{formatDateTime(e.at)}</span>
                  <button className="timeapp__x" onClick={() => cancelTimeEntry(e.id)} aria-label={`Cancel ${e.label}`}>✕</button>
                </li>
              ))}
          </ul>
        )}
        {fired.length > 0 && (
          <>
            <p className="eyebrow timeapp__firedhead">Recently fired</p>
            <ul className="timeapp__list timeapp__list--fired">
              {fired.map((e) => (
                <li key={e.id} className="timeapp__entry faint">
                  <span className="mono" aria-hidden>{KIND_GLYPHS[e.kind]}</span>
                  <span className="timeapp__entry-label">
                    {e.label}
                    {e.missed && <span className="chip timeapp__src">missed</span>}
                    {e.recurrence !== "none" && <span className="mono faint"> · {e.recurrence}</span>}
                  </span>
                  <span className="mono">{formatDateTime(e.firedAt ?? e.lastFiredAt ?? e.at)}</span>
                  {e.firedAt && (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => snoozeEntry(e.id, 10)}
                      title="Reschedule 10 minutes from now (Time Core reschedule)"
                    >
                      Snooze 10m
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="About this app">
        <FutureNote
          items={[
            "Full calendar views and rich recurrence rules",
            "World clock, routines, and availability",
            "Time-based automation triggers surfaced to every app",
          ]}
        />
      </Section>
    </div>
  );
}
