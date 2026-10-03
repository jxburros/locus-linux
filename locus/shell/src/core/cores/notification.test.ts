import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NotificationModule from "./notification";
import type * as TimeModule from "./time";

// Notification Core (and the private notifications.ts store it wraps) keep
// module-level caches, same as Time Core — reset the whole module graph
// between tests instead of reaching into private state.
let Notif: typeof NotificationModule;
let Time: typeof TimeModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Notif = await import("./notification");
  Time = await import("./time");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("notification policy", () => {
  it("defaults to quiet hours disabled, 22-7, no muted sources", () => {
    expect(Notif.getNotificationPolicy()).toEqual({
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 7,
      mutedSources: [],
    });
  });

  it("setNotificationPolicy patches over the defaults", () => {
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 23 });
    expect(Notif.getNotificationPolicy()).toEqual({
      quietEnabled: true,
      quietStartHour: 23,
      quietEndHour: 7,
      mutedSources: [],
    });
  });

  it("setSourceMuted adds and removes a source", () => {
    Notif.setSourceMuted("Monitor", true);
    expect(Notif.getNotificationPolicy().mutedSources).toEqual(["Monitor"]);
    Notif.setSourceMuted("Monitor", false);
    expect(Notif.getNotificationPolicy().mutedSources).toEqual([]);
  });
});

describe("inQuietHours", () => {
  it("is always false when quiet hours are disabled", () => {
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 23, 0).getTime())).toBe(false);
  });

  it("handles a range that wraps midnight (22-7)", () => {
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 22, quietEndHour: 7 });
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 23, 0).getTime())).toBe(true);
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 3, 0).getTime())).toBe(true);
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 12, 0).getTime())).toBe(false);
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 7, 0).getTime())).toBe(false); // end is exclusive
  });

  it("handles a range that does not wrap (9-17)", () => {
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 9, quietEndHour: 17 });
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 12, 0).getTime())).toBe(true);
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 8, 0).getTime())).toBe(false);
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 17, 0).getTime())).toBe(false);
  });

  it("treats an equal start/end hour as never quiet", () => {
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 9, quietEndHour: 9 });
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 9, 0).getTime())).toBe(false);
    expect(Notif.inQuietHours(new Date(2026, 0, 1, 15, 0).getTime())).toBe(false);
  });
});

describe("deliver", () => {
  it("delivers a normal notification as unread", () => {
    Notif.deliver({ title: "Hello", source: "Test" });
    expect(Notif.unreadCount()).toBe(1);
    expect(Notif.getNotifications()[0].title).toBe("Hello");
  });

  it("lands a muted source already-read with no attention", () => {
    Notif.setSourceMuted("Monitor", true);
    Notif.deliver({ title: "Watch tripped", source: "Monitor" });
    expect(Notif.unreadCount()).toBe(0);
    expect(Notif.getNotifications()[0].read).toBe(true);
  });

  it("holds a non-critical delivery during quiet hours out of the unread count", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0));
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 22, quietEndHour: 7 });

    Notif.deliver({ title: "Quiet-hours item", source: "Time" });

    expect(Notif.unreadCount()).toBe(0);
    const n = Notif.getNotifications()[0];
    expect(n.read).toBe(false);
    expect(n.heldUntil).toBe(new Date(2026, 0, 2, 7, 0).getTime());
    expect(Notif.isHeld(n)).toBe(true);
  });

  it("always breaks through quiet hours and mute for critical priority", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0));
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 22, quietEndHour: 7 });
    Notif.setSourceMuted("System", true);

    Notif.deliver({ title: "Storage full", source: "System", priority: "critical" });

    expect(Notif.unreadCount()).toBe(1);
    const n = Notif.getNotifications()[0];
    expect(n.read).toBe(false);
    expect(n.snoozedUntil).toBeUndefined();
  });

  it("redacts title and detail through a registered redactor", () => {
    Notif.setNotificationRedactor((text) => text.replace(/secret-\w+/g, "[redacted]"));
    Notif.deliver({ title: "Key: secret-abc123", detail: "also secret-xyz", source: "Test" });
    const n = Notif.getNotifications()[0];
    expect(n.title).toBe("Key: [redacted]");
    expect(n.detail).toBe("also [redacted]");
  });
});

describe("groupBySource", () => {
  it("groups history by source, newest group first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 10, 0));
    Notif.deliver({ title: "A1", source: "A" });
    vi.setSystemTime(new Date(2026, 0, 1, 11, 0));
    Notif.deliver({ title: "B1", source: "B" });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0));
    Notif.deliver({ title: "A2", source: "A" });

    const groups = Notif.groupBySource();
    expect(groups.map((g) => g.source)).toEqual(["A", "B"]);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe("initNotificationCore — held-item release job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("nudges subscribers once a held notification's quiet window passes", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0));
    Notif.setNotificationPolicy({ quietEnabled: true, quietStartHour: 22, quietEndHour: 7 });
    Notif.deliver({ title: "Held", source: "Time" });
    expect(Notif.unreadCount()).toBe(0);

    let notified = 0;
    Notif.subscribeNotifications(() => {
      notified += 1;
    });

    Time.initTimeCore();
    Notif.initNotificationCore();

    // Jump to just after the held item's snoozedUntil (tomorrow 7am), then
    // let one Time Core tick (5s) run the notification-release job (30s).
    vi.setSystemTime(new Date(2026, 0, 2, 7, 0, 1));
    vi.advanceTimersByTime(30_000);

    expect(notified).toBeGreaterThan(0);
    expect(Notif.unreadCount()).toBe(1);
  });
});

describe("hold vs snooze split + pending/history eviction (Wave 3)", () => {
  it("disabling quiet hours releases policy holds immediately but keeps user snoozes", () => {
    // Force quiet hours around "now".
    const hour = new Date().getHours();
    Notif.setNotificationPolicy({
      quietEnabled: true,
      quietStartHour: hour,
      quietEndHour: (hour + 2) % 24,
    });
    Notif.deliver({ title: "held by policy", source: "Test" });
    Notif.deliver({ title: "snoozed by user", source: "Test" });
    const snoozed = Notif.getNotifications().find((n) => n.title === "snoozed by user")!;
    Notif.snoozeNotification(snoozed.id, 60);
    expect(Notif.unreadCount()).toBe(0); // both held out
    // Turn quiet hours off: the POLICY hold releases, the USER snooze stays.
    Notif.setNotificationPolicy({ quietEnabled: false });
    const items = Notif.getNotifications();
    const held = items.find((n) => n.title === "held by policy")!;
    const stillSnoozed = items.find((n) => n.title === "snoozed by user")!;
    expect(Notif.isHeld(held)).toBe(false);
    expect(Notif.isHeld(stillSnoozed)).toBe(true);
    expect(Notif.unreadCount()).toBe(1);
  });

  it("the history cap never evicts unread, held, or critical items", () => {
    // One critical + one held unread, then flood with read history.
    Notif.deliver({ title: "critical thing", source: "Test", priority: "critical" });
    const hour = new Date().getHours();
    Notif.setNotificationPolicy({
      quietEnabled: true,
      quietStartHour: hour,
      quietEndHour: (hour + 2) % 24,
    });
    Notif.deliver({ title: "held unread", source: "Test" });
    // Keep the hold live while flooding with READ history (muted source
    // deliveries land already read, so they are evictable history).
    Notif.setSourceMuted("Muted", true);
    for (let i = 0; i < 110; i++) {
      Notif.deliver({ title: `noise ${i}`, source: "Muted" });
    }
    const items = Notif.getNotifications();
    const titles = items.map((n) => n.title);
    expect(titles).toContain("critical thing");
    expect(titles).toContain("held unread");
    // The read history itself was capped.
    expect(items.filter((n) => n.read).length).toBeLessThanOrEqual(60);
  });
});
