import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TimeModule from "./time";

// Time Core keeps module-level caches (entries, scheduler jobs, fire
// listeners) that a real SPA session never needs to reset. Tests reset the
// whole module graph between cases instead of reaching for a private API,
// so each test gets an isolated instance — same pattern used across the
// Core Services layer test suites.
let Time: typeof TimeModule;

async function freshModule(): Promise<typeof TimeModule> {
  vi.resetModules();
  localStorage.clear();
  return import("./time");
}

beforeEach(async () => {
  Time = await freshModule();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("local-date helpers", () => {
  it("formats a timestamp as its local yyyy-mm-dd day", () => {
    const d = new Date(2026, 2, 5, 23, 30); // local March 5 2026, 23:30
    expect(Time.toLocalDay(d)).toBe("2026-03-05");
  });

  it("pads single-digit months and days", () => {
    const d = new Date(2026, 0, 9);
    expect(Time.toLocalDay(d)).toBe("2026-01-09");
  });

  it("todayLocal matches toLocalDay(now)", () => {
    expect(Time.todayLocal()).toBe(Time.toLocalDay(new Date()));
  });

  it("daysSince counts whole local calendar days, not 24h blocks", () => {
    const day1 = new Date(2026, 5, 1, 23, 0).getTime(); // 11pm
    const day2 = new Date(2026, 5, 2, 1, 0).getTime(); // 1am next day, 2h later
    expect(Time.daysSince(day1, day2)).toBe(1);
  });

  it("daysSince is 0 for the same local day", () => {
    const morning = new Date(2026, 5, 1, 8, 0).getTime();
    const night = new Date(2026, 5, 1, 23, 0).getTime();
    expect(Time.daysSince(morning, night)).toBe(0);
  });

  it("onOrBeforeDay / onOrAfterDay compare day strings chronologically", () => {
    expect(Time.onOrBeforeDay("2026-01-01", "2026-01-02")).toBe(true);
    expect(Time.onOrBeforeDay("2026-01-02", "2026-01-02")).toBe(true);
    expect(Time.onOrBeforeDay("2026-01-03", "2026-01-02")).toBe(false);
    expect(Time.onOrAfterDay("2026-01-03", "2026-01-02")).toBe(true);
    expect(Time.onOrAfterDay("2026-01-01", "2026-01-02")).toBe(false);
  });
});

describe("hour cycle + formatting", () => {
  it("defaults to auto", () => {
    expect(Time.getHourCycle()).toBe("auto");
  });

  it("persists an explicit hour cycle", () => {
    Time.setHourCycle("24");
    expect(Time.getHourCycle()).toBe("24");
  });

  it("formatTime respects an explicit 12 vs 24 hour cycle", () => {
    const d = new Date(2026, 0, 1, 13, 0); // 1pm
    Time.setHourCycle("24");
    const h24 = Time.formatTime(d);
    Time.setHourCycle("12");
    const h12 = Time.formatTime(d);
    expect(h24).not.toBe(h12);
  });

  it("formatDateTime combines formatDate and formatTime", () => {
    const d = new Date(2026, 0, 1, 13, 0);
    expect(Time.formatDateTime(d)).toBe(`${Time.formatDate(d)} ${Time.formatTime(d)}`);
  });
});

describe("createTimeEntry and its shorthands", () => {
  it("creates an alarm with recurrence 'none' by default", () => {
    const e = Time.createAlarm("Wake up", Date.now() + 1000);
    expect(e.kind).toBe("alarm");
    expect(e.recurrence).toBe("none");
    expect(e.anchorAt).toBeUndefined();
  });

  it("sets anchorAt to `at` for a recurring entry when not given explicitly", () => {
    const at = Date.now() + 1000;
    const e = Time.createAlarm("Daily wake up", at, "daily");
    expect(e.anchorAt).toBe(at);
  });

  it("creates a timer whose `at` is now + duration", () => {
    const now = Date.now();
    const e = Time.createTimer("Tea", 60_000);
    expect(e.durationMs).toBe(60_000);
    expect(e.at).toBeGreaterThanOrEqual(now + 60_000);
  });

  it("creates a reminder carrying its source and dedupeKey", () => {
    const e = Time.createReminder("Call mom", Date.now() + 1000, "people", {
      dedupeKey: "birthday:contact-1",
    });
    expect(e.kind).toBe("reminder");
    expect(e.source).toBe("people");
    expect(e.dedupeKey).toBe("birthday:contact-1");
  });

  it("creates a durable trigger with payload + targetCore via requestTrigger", () => {
    const e = Time.requestTrigger("Birthday fires", Date.now() + 1000, "people", {
      payload: { contactId: "c1" },
      targetCore: "people",
      dedupeKey: "birthday:c1",
    });
    expect(e.kind).toBe("trigger");
    expect(e.payload).toEqual({ contactId: "c1" });
    expect(e.targetCore).toBe("people");
  });

  it("is idempotent for a repeated dedupeKey while the entry is unfired", () => {
    const first = Time.createReminder("Once", Date.now() + 1000, "user", {
      dedupeKey: "k1",
    });
    const second = Time.createReminder("Once again", Date.now() + 5000, "user", {
      dedupeKey: "k1",
    });
    expect(second.id).toBe(first.id);
    expect(Time.getTimeEntries()).toHaveLength(1);
  });
});

describe("reschedule / snooze / cancel", () => {
  it("rescheduleEntry moves `at` without touching anchorAt", () => {
    const at = Date.now() + 1000;
    const created = Time.createAlarm("Daily", at, "daily");
    const moved = Time.rescheduleEntry(created.id, at + 60_000);
    expect(moved?.at).toBe(at + 60_000);
    expect(moved?.anchorAt).toBe(created.anchorAt);
  });

  it("snoozeEntry pushes `at` forward by N minutes from now", () => {
    const created = Time.createAlarm("Alarm", Date.now() + 1000);
    const before = Date.now();
    const snoozed = Time.snoozeEntry(created.id, 5);
    expect(snoozed?.at).toBeGreaterThanOrEqual(before + 5 * 60_000);
  });

  it("cancelTimeEntry removes the entry", () => {
    const created = Time.createAlarm("Gone soon", Date.now() + 1000);
    Time.cancelTimeEntry(created.id);
    expect(Time.getTimeEntries().find((e) => e.id === created.id)).toBeUndefined();
  });

  it("cancelTimeEntriesByDedupeKey removes only unfired matches and reports the count", () => {
    Time.createReminder("A", Date.now() + 1000, "user", { dedupeKey: "grp" });
    Time.createReminder("B", Date.now() + 2000, "user", { dedupeKey: "other" });
    const removed = Time.cancelTimeEntriesByDedupeKey("grp");
    expect(removed).toBe(1);
    expect(Time.getTimeEntries().some((e) => e.dedupeKey === "grp")).toBe(false);
    expect(Time.getTimeEntries().some((e) => e.dedupeKey === "other")).toBe(true);
  });
});

describe("upcomingEntries / firedEntries / describeUpcoming", () => {
  it("upcomingEntries returns unfired entries soonest-first", () => {
    Time.createAlarm("Later", Date.now() + 10_000);
    Time.createAlarm("Sooner", Date.now() + 1_000);
    const [first, second] = Time.upcomingEntries();
    expect(first.label).toBe("Sooner");
    expect(second.label).toBe("Later");
  });

  it("describeUpcoming renders a plain-language line per entry", () => {
    Time.createAlarm("Wake up", Date.now() + 1000, "daily");
    const [line] = Time.describeUpcoming(1);
    expect(line).toContain("Alarm");
    expect(line).toContain("Wake up");
    expect(line).toContain("repeats daily");
  });
});

describe("nextOccurrence", () => {
  it("returns `at` unchanged for recurrence 'none'", () => {
    const at = Date.now();
    expect(Time.nextOccurrence(at, "none", at + 10_000)).toBe(at);
  });

  it("advances a daily recurrence to the next day at the same wall-clock time", () => {
    const anchor = new Date(2026, 2, 1, 8, 0).getTime(); // Mar 1, 8:00
    const now = new Date(2026, 2, 1, 9, 0).getTime(); // past due same day
    const next = Time.nextOccurrence(anchor, "daily", now, anchor);
    const d = new Date(next);
    expect(d.getDate()).toBe(2);
    expect(d.getHours()).toBe(8);
  });

  it("fast-forwards a daily recurrence across many missed days", () => {
    const anchor = new Date(2020, 0, 1, 8, 0).getTime();
    const now = new Date(2026, 2, 1, 9, 0).getTime();
    const next = Time.nextOccurrence(anchor, "daily", now, anchor);
    expect(next).toBeGreaterThan(now);
    expect(new Date(next).getHours()).toBe(8);
  });

  it("advances a weekly recurrence by 7 days", () => {
    const anchor = new Date(2026, 2, 1, 8, 0).getTime(); // a Sunday
    const now = anchor + 1000;
    const next = Time.nextOccurrence(anchor, "weekly", now, anchor);
    expect(next).toBe(new Date(2026, 2, 8, 8, 0).getTime());
  });

  it("clamps a monthly 31st anchor into short months, then returns to the 31st", () => {
    const anchor = new Date(2026, 0, 31, 9, 0).getTime(); // Jan 31
    const afterJan = Time.nextOccurrence(anchor, "monthly", anchor + 1000, anchor);
    expect(new Date(afterJan).getMonth()).toBe(1); // February
    expect(new Date(afterJan).getDate()).toBe(28); // clamped, 2026 is not a leap year

    const afterFeb = Time.nextOccurrence(anchor, "monthly", afterJan + 1000, anchor);
    expect(new Date(afterFeb).getMonth()).toBe(2); // March
    expect(new Date(afterFeb).getDate()).toBe(31); // back to the anchor's day
  });

  it("clamps a yearly Feb-29 anchor to Feb 28 in non-leap years", () => {
    const anchor = new Date(2024, 1, 29, 10, 0).getTime(); // 2024 is a leap year
    const now = new Date(2025, 0, 1).getTime();
    const next = Time.nextOccurrence(anchor, "yearly", now, anchor);
    expect(new Date(next).getFullYear()).toBe(2025);
    expect(new Date(next).getMonth()).toBe(1); // February
    expect(new Date(next).getDate()).toBe(28);
  });

  it("returns to Feb 29 once a leap year comes back around", () => {
    const anchor = new Date(2024, 1, 29, 10, 0).getTime();
    let occurrence = Time.nextOccurrence(anchor, "yearly", new Date(2025, 0, 1).getTime(), anchor);
    expect(new Date(occurrence).getFullYear()).toBe(2025); // clamped to Feb 28
    // Each further call walks from the fixed anchor to the next year still
    // ahead of `now` — feeding in "just past the last landing" to simulate
    // the entry being checked again right after it fired.
    for (const expectedYear of [2026, 2027, 2028]) {
      occurrence = Time.nextOccurrence(anchor, "yearly", occurrence + 1000, anchor);
      expect(new Date(occurrence).getFullYear()).toBe(expectedYear);
    }
    expect(new Date(occurrence).getDate()).toBe(29); // 2028 is a leap year again
  });
});

describe("registerScheduledJob + initTimeCore scheduler tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("fires a due entry through onTimeFire and marks it fired", () => {
    const dueAt = Date.now() + 1000;
    const created = Time.createAlarm("Ping", dueAt);
    const fired: string[] = [];
    Time.onTimeFire((e) => fired.push(e.id));

    Time.initTimeCore(); // immediate tick — not due yet
    expect(fired).toHaveLength(0);

    vi.setSystemTime(dueAt + 1);
    vi.advanceTimersByTime(5000); // one scheduler tick

    expect(fired).toEqual([created.id]);
    const stored = Time.getTimeEntries().find((e) => e.id === created.id);
    expect(stored?.firedAt).toBeDefined();
  });

  it("marks an entry missed when it is found long past due", () => {
    const dueAt = Date.now() - 60 * 60_000; // an hour ago, unfired
    Time.createAlarm("Old", dueAt);

    Time.initTimeCore(); // immediate tick fires it right away, as missed

    const stored = Time.getTimeEntries()[0];
    expect(stored.missed).toBe(true);
    expect(stored.firedAt).toBeDefined();
  });

  it("advances (not deletes) a recurring entry on fire, leaving it unfired for future ticks", () => {
    const dueAt = Date.now() + 1000;
    const created = Time.createAlarm("Daily ping", dueAt, "daily");

    Time.initTimeCore();
    vi.setSystemTime(dueAt + 1);
    vi.advanceTimersByTime(5000);

    const stored = Time.getTimeEntries().find((e) => e.id === created.id);
    expect(stored?.firedAt).toBeUndefined();
    expect(stored?.lastFiredAt).toBeDefined();
    expect(stored?.at).toBeGreaterThan(dueAt);
  });

  it("runs a registered scheduled job on its own cadence via the same tick", () => {
    let calls = 0;
    Time.registerScheduledJob("test-job", 10_000, () => {
      calls += 1;
    });
    Time.initTimeCore(); // immediate run — job's lastRun starts at 0, so this counts
    expect(calls).toBe(1);

    vi.advanceTimersByTime(5000); // tick again, job not due yet (needs 10s)
    expect(calls).toBe(1);

    vi.advanceTimersByTime(5000); // 10s total since the job's lastRun
    expect(calls).toBe(2);
  });
});

describe("DST gap/fold policy (nextOccurrence)", () => {
  it("re-asserts the anchor's wall-clock time on every step so a shift never sticks", () => {
    // Simulate what a spring-forward normalization does: hand nextOccurrence
    // an anchor at 02:30 and advance many days — every produced occurrence
    // must carry the anchor's wall-clock time (02:30), never an accumulated
    // shift, regardless of the zone the test runs in.
    const anchor = new Date(2026, 2, 1, 2, 30, 0, 0).getTime(); // Mar 1, 02:30
    let at = anchor;
    let now = anchor;
    for (let i = 0; i < 45; i++) {
      at = Time.nextOccurrence(at, "daily", now, anchor);
      now = at;
      const d = new Date(at);
      const hm = d.getHours() * 60 + d.getMinutes();
      // Wall-clock 02:30, or 03:30 exactly on a spring-forward gap day where
      // 02:30 does not exist (the documented "shift forward" gap policy).
      expect([150, 210]).toContain(hm);
    }
  });
});

describe("recurring missed outcome", () => {
  it("retains lastMissedAt when a recurring entry fires as missed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    // Due two hours ago — far past the missed grace window.
    const dueAt = Date.now() - 2 * 60 * 60_000;
    Time.createTimeEntry({ kind: "reminder", label: "daily med", at: dueAt, recurrence: "daily" });
    Time.initTimeCore();
    const stored = Time.getTimeEntries().find((e) => e.label === "daily med");
    expect(stored?.lastMissedAt).toBeDefined();
    expect(stored?.at).toBeGreaterThan(Date.now());
  });
});

describe("durable dispatch outbox", () => {
  it("persists a pending dispatch when the target consumer is not registered, and delivers it on registration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    Time.requestTrigger("do the thing", Date.now() - 1000, "test", {
      targetCore: "people",
      payload: { contactId: "c-1" },
    });
    Time.initTimeCore(); // fires; no consumer registered yet
    let pending = Time.dispatchOutbox().filter((r) => r.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ contactId: "c-1" });

    const delivered: string[] = [];
    Time.onCoreDispatch("people", (r) => delivered.push(r.label));
    expect(delivered).toEqual(["do the thing"]);
    pending = Time.dispatchOutbox().filter((r) => r.status === "pending");
    expect(pending).toHaveLength(0);
    expect(Time.dispatchOutbox()[0].status).toBe("acked");
  });

  it("retries a throwing consumer and dead-letters after max attempts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    let calls = 0;
    Time.onCoreDispatch("monitor", () => {
      calls += 1;
      throw new Error("consumer exploded");
    });
    Time.requestTrigger("fragile", Date.now() - 1000, "test", { targetCore: "monitor" });
    Time.initTimeCore(); // fire -> attempt 1 (throws)
    expect(calls).toBe(1);
    expect(Time.dispatchOutbox()[0].status).toBe("pending");
    // Each retry needs its backoff (30s * attempts) to elapse; ticks run every 5s.
    for (let i = 0; i < 200 && Time.dispatchOutbox()[0].status === "pending"; i++) {
      vi.advanceTimersByTime(30_000);
    }
    expect(Time.dispatchOutbox()[0].status).toBe("dead");
    expect(calls).toBe(5); // DISPATCH_MAX_ATTEMPTS
    expect(Time.dispatchOutbox()[0].error).toMatch(/consumer exploded/);
  });

  it("acks immediately when the consumer is registered before the fire", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    const got: (Record<string, unknown> | undefined)[] = [];
    Time.onCoreDispatch("people", (r) => got.push(r.payload));
    Time.requestTrigger("birthday", Date.now() - 1000, "people", {
      targetCore: "people",
      payload: { contactId: "c-9" },
    });
    Time.initTimeCore();
    expect(got).toEqual([{ contactId: "c-9" }]);
    expect(Time.dispatchOutbox()[0].status).toBe("acked");
  });
});
