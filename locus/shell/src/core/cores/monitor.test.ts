import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as MonitorModule from "./monitor";
import type * as ObjectsModule from "../objects";
import type * as CardspokeModule from "./cardspoke";
import type * as PeopleModule from "./people";
import type * as TimeModule from "./time";

let Monitor: typeof MonitorModule;
let Objects: typeof ObjectsModule;
let Cardspoke: typeof CardspokeModule;
let People: typeof PeopleModule;
let Time: typeof TimeModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Monitor = await import("./monitor");
  Objects = await import("../objects");
  Cardspoke = await import("./cardspoke");
  People = await import("./people");
  Time = await import("./time");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createWatch validation", () => {
  it("requires an existing object for file-change/stale-item watches", () => {
    expect(() => Monitor.createWatch({ name: "x", type: "file-change" })).toThrow(/existing object/);
    expect(() =>
      Monitor.createWatch({ name: "x", type: "file-change", params: { objectId: "missing" } }),
    ).toThrow(/existing object/);
  });

  it("requires a URL for webpage watches", () => {
    expect(() => Monitor.createWatch({ name: "x", type: "webpage" })).toThrow(/URL/);
  });

  it("snapshots a file-change watch's baseline updatedAt on creation", () => {
    const doc = Objects.createObject({ type: "document", title: "Doc" });
    const w = Monitor.createWatch({
      name: "Doc watch",
      type: "file-change",
      params: { objectId: doc.id },
    });
    expect(w.snapshot?.updatedAt).toBe(doc.updatedAt);
  });

  it("webpage watches without checkEnabled start pending; others start ok", () => {
    const w1 = Monitor.createWatch({ name: "Page", type: "webpage", params: { url: "https://x" } });
    expect(w1.status).toBe("pending");
    const w2 = Monitor.createWatch({ name: "Storage", type: "storage" });
    expect(w2.status).toBe("ok");
  });
});

describe("watch CRUD", () => {
  it("updateWatch merges params instead of replacing them", () => {
    const w = Monitor.createWatch({ name: "S", type: "storage", params: { thresholdBytes: 100 } });
    Monitor.updateWatch(w.id, { params: { thresholdBytes: 200 } });
    expect(Monitor.listWatches()[0].params).toEqual({ thresholdBytes: 200 });
  });

  it("setWatchEnabled / snoozeWatch / deleteWatch", () => {
    const w = Monitor.createWatch({ name: "S", type: "storage" });
    Monitor.setWatchEnabled(w.id, false);
    expect(Monitor.listWatches()[0].enabled).toBe(false);
    Monitor.snoozeWatch(w.id, 10);
    expect(Monitor.listWatches()[0].snoozedUntil).toBeGreaterThan(Date.now());
    Monitor.deleteWatch(w.id);
    expect(Monitor.listWatches()).toHaveLength(0);
  });
});

describe("evaluation — storage watch", () => {
  it("alerts once over threshold, does not re-alert on the next unchanged pass", () => {
    const w = Monitor.createWatch({ name: "S", type: "storage", params: { thresholdBytes: 1 } });
    Monitor.checkAllNow();
    let events = Monitor.watchEvents();
    expect(events).toHaveLength(1);
    expect(Monitor.listWatches()[0].status).toBe("warning");

    Monitor.checkAllNow(); // still over threshold, same fingerprint
    events = Monitor.watchEvents();
    expect(events).toHaveLength(1); // no repeat alert
    void w;
  });
});

describe("evaluation — task-deadline watch", () => {
  it("alerts on overdue tasks and recovers when they clear", () => {
    Monitor.createWatch({ name: "Deadlines", type: "task-deadline" });
    const task = Cardspoke.createCard({ type: "task", title: "Late", due: "2000-01-01" });
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("warning");
    expect(Monitor.watchEvents()[0].message).toContain("Late");

    Cardspoke.setCardStatus(task.id, true); // no longer overdue
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("ok");
    expect(Monitor.watchEvents()[0].message).toBe("Back to normal");
  });

  it("re-alerts when the set of overdue tasks changes (new fingerprint) even while still warning", () => {
    Monitor.createWatch({ name: "Deadlines", type: "task-deadline" });
    Cardspoke.createCard({ type: "task", title: "Late1", due: "2000-01-01" });
    Monitor.checkAllNow();
    expect(Monitor.watchEvents()).toHaveLength(1);

    Cardspoke.createCard({ type: "task", title: "Late2", due: "2000-01-02" });
    Monitor.checkAllNow(); // still warning, but a new task joined -> new fingerprint
    expect(Monitor.watchEvents()).toHaveLength(2);
  });
});

describe("evaluation — file-change watch (event-style)", () => {
  it("alerts on each change and never holds a warning status", () => {
    // Fake timers + an explicit tick between edits: the watch detects a
    // change via `updatedAt` strictly increasing, so two edits landing in
    // the same millisecond would be (mis)read as "no change" — a real but
    // practically unreachable edge case for human/AI edit cadence.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const doc = Objects.createObject({ type: "document", title: "Doc", body: "v1" });
    Monitor.createWatch({ name: "Doc", type: "file-change", params: { objectId: doc.id } });
    Monitor.checkAllNow();
    expect(Monitor.watchEvents()).toHaveLength(0); // no change yet
    expect(Monitor.listWatches()[0].status).toBe("ok");

    vi.advanceTimersByTime(1);
    Objects.updateObject(doc.id, { body: "v2" });
    Monitor.checkAllNow();
    expect(Monitor.watchEvents()).toHaveLength(1);
    expect(Monitor.listWatches()[0].status).toBe("ok"); // event-style: never "warning"

    Monitor.checkAllNow(); // no further change
    expect(Monitor.watchEvents()).toHaveLength(1);
  });

  it("marks the watch missing and disables it when the target is deleted", () => {
    const doc = Objects.createObject({ type: "document", title: "Doc" });
    Monitor.createWatch({ name: "Doc", type: "file-change", params: { objectId: doc.id } });
    Objects.deleteObject(doc.id);
    Monitor.checkAllNow();
    const w = Monitor.listWatches()[0];
    expect(w.status).toBe("missing");
    expect(w.enabled).toBe(false);
  });
});

describe("evaluation — stale-item watch", () => {
  it("alerts once idle time exceeds staleDays", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const doc = Objects.createObject({ type: "document", title: "Doc" });
    Monitor.createWatch({
      name: "Stale",
      type: "stale-item",
      params: { objectId: doc.id, staleDays: 5 },
    });
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("ok");

    vi.setSystemTime(new Date(2026, 0, 7)); // 6 days later
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("warning");
  });
});

describe("evaluation — contact-cadence watch", () => {
  it("alerts on contacts due for follow-up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const contact = People.addContact({ name: "Ada" });
    People.logInteraction(contact.id, "call");
    Monitor.createWatch({ name: "Cadence", type: "contact-cadence", params: { days: 5 } });

    vi.setSystemTime(new Date(2026, 0, 8));
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("warning");
    expect(Monitor.watchEvents()[0].message).toContain("Ada");
  });
});

describe("cooldown", () => {
  it("suppresses a repeat notification within minIntervalMs, but still updates status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    Monitor.createWatch({
      name: "Deadlines",
      type: "task-deadline",
      minIntervalMs: 60 * 60_000, // 1 hour
    });
    Cardspoke.createCard({ type: "task", title: "Late1", due: "2000-01-01" });
    Monitor.checkAllNow();
    expect(Monitor.watchEvents()).toHaveLength(1);

    Cardspoke.createCard({ type: "task", title: "Late2", due: "2000-01-02" }); // new fingerprint
    Monitor.checkAllNow(); // still within cooldown
    expect(Monitor.watchEvents()).toHaveLength(1); // no new event yet
    expect(Monitor.listWatches()[0].status).toBe("warning"); // status still updates

    vi.setSystemTime(new Date(2026, 0, 1, 1, 1)); // just past the 1h cooldown
    Monitor.checkAllNow();
    expect(Monitor.watchEvents()).toHaveLength(2); // the pending fingerprint change now alerts
  });
});

describe("escalation", () => {
  it("escalates to critical after escalateAfterFails consecutive alerting passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    Monitor.createWatch({
      name: "Deadlines",
      type: "task-deadline",
      escalateAfterFails: 3,
      frequencyMs: 1000,
    });
    Cardspoke.createCard({ type: "task", title: "Late", due: "2000-01-01" });

    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("warning");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 2));
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("warning");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 4));
    Monitor.checkAllNow();
    expect(Monitor.listWatches()[0].status).toBe("critical");
  });
});

describe("suggestedWatches", () => {
  it("suggests storage watch when none exists yet", () => {
    expect(Monitor.suggestedWatches().some((s) => s.type === "storage")).toBe(true);
  });

  it("does not re-suggest storage once a storage watch exists", () => {
    Monitor.createWatch({ name: "S", type: "storage" });
    expect(Monitor.suggestedWatches().some((s) => s.type === "storage")).toBe(false);
  });

  it("suggests task-deadline only when a task with a due date exists", () => {
    expect(Monitor.suggestedWatches().some((s) => s.type === "task-deadline")).toBe(false);
    Cardspoke.createCard({ type: "task", title: "T", due: "2026-01-01" });
    expect(Monitor.suggestedWatches().some((s) => s.type === "task-deadline")).toBe(true);
  });
});

describe("webpage watch (mocked fetch)", () => {
  it("marks reachable on a successful HEAD request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const w = Monitor.createWatch({
      name: "Page",
      type: "webpage",
      params: { url: "https://example.com", checkEnabled: true },
    });
    Monitor.checkAllNow();
    await vi.waitFor(() => {
      expect(Monitor.listWatches().find((x) => x.id === w.id)?.status).toBe("ok");
    });
  });

  it("marks unreachable on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const w = Monitor.createWatch({
      name: "Page",
      type: "webpage",
      params: { url: "https://example.com", checkEnabled: true },
    });
    Monitor.checkAllNow();
    await vi.waitFor(() => {
      expect(Monitor.listWatches().find((x) => x.id === w.id)?.status).toBe("warning");
    });
  });
});

describe("initMonitorCore + Time Core scheduler integration", () => {
  it("runs the evaluator on Time Core's schedule", () => {
    vi.useFakeTimers();
    Cardspoke.createCard({ type: "task", title: "Late", due: "2000-01-01" });
    Monitor.createWatch({ name: "Deadlines", type: "task-deadline", frequencyMs: 1000 });

    Time.initTimeCore();
    Monitor.initMonitorCore();
    vi.advanceTimersByTime(15_000); // monitor-evaluator job cadence

    expect(Monitor.listWatches()[0].status).toBe("warning");
  });
});

describe("brokered AI watch creation (Wave 3)", () => {
  it("refuses direct createWatch({createdBy:'ai'}) but creates through an approved proposal", async () => {
    const Broker = await import("../broker");
    expect(() =>
      Monitor.createWatch({ name: "sneaky", type: "storage", createdBy: "ai" }),
    ).toThrow(/approved proposal/i);

    Monitor.initMonitorCore();
    const proposal = await Monitor.requestWatchCreation({
      name: "Storage headroom",
      type: "storage",
      severity: "warning",
      purpose: "keep an eye on quota",
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe("pending"); // approval required
    expect(Monitor.listWatches()).toHaveLength(0); // nothing written yet
    await Broker.approve(proposal!.id);
    const watches = Monitor.listWatches();
    expect(watches).toHaveLength(1);
    expect(watches[0].name).toBe("Storage headroom");
    expect(watches[0].createdBy).toBe("ai-approved");
  });

  it("fails the executor honestly on an invalid watch spec", async () => {
    const Broker = await import("../broker");
    Monitor.initMonitorCore();
    const proposal = await Monitor.requestWatchCreation({
      name: "Bad",
      type: "file-change", // requires an existing objectId
      params: { objectId: "missing" },
    });
    const out = await Broker.approve(proposal!.id);
    expect(out?.status).toBe("failed");
    expect(Monitor.listWatches()).toHaveLength(0);
  });
});

describe("webpage watch cooldown/escalation state (Wave 3)", () => {
  it("persists consecutive failures, escalates to critical, and records recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    const failing = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", failing);
    Monitor.initMonitorCore();
    const w = Monitor.createWatch({
      name: "Site up",
      type: "webpage",
      params: { url: "https://example.com", checkEnabled: true },
      frequencyMs: 1000,
      severity: "warning",
      escalateAfterFails: 2,
    });
    // First failing pass: warning, one consecutive fail.
    Monitor.checkAllNow();
    await vi.advanceTimersByTimeAsync(10_000);
    let stored = Monitor.listWatches().find((x) => x.id === w.id)!;
    expect(stored.status).toBe("warning");
    expect(stored.consecutiveFails).toBe(1);
    // Second failing pass: escalates to critical.
    Monitor.checkAllNow();
    await vi.advanceTimersByTimeAsync(10_000);
    stored = Monitor.listWatches().find((x) => x.id === w.id)!;
    expect(stored.status).toBe("critical");
    expect(stored.consecutiveFails).toBe(2);
    // Recovery: reachable again → ok, fails reset, recovery on the record.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    Monitor.checkAllNow();
    await vi.advanceTimersByTimeAsync(10_000);
    stored = Monitor.listWatches().find((x) => x.id === w.id)!;
    expect(stored.status).toBe("ok");
    expect(stored.consecutiveFails).toBe(0);
    expect(Monitor.watchEvents().some((e) => /reachable again/i.test(e.message))).toBe(true);
    vi.useRealTimers();
  });

  it("drops an in-flight result when the watch was paused or its URL edited meanwhile", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    let rejectFetch: (e: Error) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((_, rej) => (rejectFetch = rej))),
    );
    Monitor.initMonitorCore();
    const w = Monitor.createWatch({
      name: "Site",
      type: "webpage",
      params: { url: "https://example.com", checkEnabled: true },
      frequencyMs: 1000,
    });
    Monitor.checkAllNow(); // fetch now in flight
    Monitor.setWatchEnabled(w.id, false); // user pauses while in flight
    rejectFetch(new Error("down"));
    await vi.advanceTimersByTimeAsync(1000);
    const stored = Monitor.listWatches().find((x) => x.id === w.id)!;
    // Untouched — the stale result was dropped: no alerting status, no
    // failure count, no event from the in-flight check.
    expect(stored.status).toBe("ok");
    expect(stored.consecutiveFails ?? 0).toBe(0);
    expect(stored.lastEvent).toBeUndefined();
    vi.useRealTimers();
  });
});
