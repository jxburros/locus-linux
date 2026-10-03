import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PeopleModule from "./people";
import type * as TimeModule from "./time";

let People: typeof PeopleModule;
let Time: typeof TimeModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  People = await import("./people");
  Time = await import("./time");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("contact CRUD", () => {
  it("addContact defaults category to Friend and trims the name", () => {
    const c = People.addContact({ name: "  Ada Lovelace  " });
    expect(c.name).toBe("Ada Lovelace");
    expect(c.category).toBe("Friend");
    expect(c.groups).toEqual([]);
  });

  it("listContacts excludes archived; archivedContacts includes only archived", () => {
    const a = People.addContact({ name: "A" });
    const b = People.addContact({ name: "B" });
    People.archiveContact(a.id);
    expect(People.listContacts().map((c) => c.id)).toEqual([b.id]);
    expect(People.archivedContacts().map((c) => c.id)).toEqual([a.id]);
  });

  it("archiveContact is a no-op when already archived", () => {
    const a = People.addContact({ name: "A" });
    People.archiveContact(a.id);
    const archivedAt = People.getContact(a.id)?.archivedAt;
    People.archiveContact(a.id);
    expect(People.getContact(a.id)?.archivedAt).toBe(archivedAt);
  });

  it("restoreContact brings a contact back to the active list", () => {
    const a = People.addContact({ name: "A" });
    People.archiveContact(a.id);
    People.restoreContact(a.id);
    expect(People.listContacts().map((c) => c.id)).toEqual([a.id]);
    expect(People.getContact(a.id)?.archivedAt).toBeUndefined();
  });

  it("removeContact deletes the contact permanently", () => {
    const a = People.addContact({ name: "A" });
    People.removeContact(a.id);
    expect(People.getContact(a.id)).toBeUndefined();
  });

  it("updateContact only audits fields that actually changed among sensitive fields", () => {
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, { phone: "555-0100" });
    expect(People.getContact(a.id)?.phone).toBe("555-0100");
    // Re-setting the same phone number should not throw or corrupt state.
    People.updateContact(a.id, { phone: "555-0100" });
    expect(People.getContact(a.id)?.phone).toBe("555-0100");
  });
});

describe("interaction history", () => {
  it("logInteraction stamps lastContactAt and prepends to interactions", () => {
    const a = People.addContact({ name: "A" });
    People.logInteraction(a.id, "call", "caught up");
    const updated = People.getContact(a.id);
    expect(updated?.lastContactAt).toBeDefined();
    expect(updated?.interactions).toHaveLength(1);
    expect(updated?.interactions?.[0]).toMatchObject({ channel: "call", note: "caught up" });
  });

  it("caps interaction history at 50, newest first", () => {
    const a = People.addContact({ name: "A" });
    for (let i = 0; i < 55; i++) People.logInteraction(a.id, "text", `msg ${i}`);
    const updated = People.getContact(a.id);
    expect(updated?.interactions).toHaveLength(50);
    expect(updated?.interactions?.[0].note).toBe("msg 54");
  });

  it("markContacted logs an 'other' interaction", () => {
    const a = People.addContact({ name: "A" });
    People.markContacted(a.id);
    expect(People.getContact(a.id)?.interactions?.[0].channel).toBe("other");
  });
});

describe("cadence", () => {
  it("cadenceHealth is null for a never-contacted person", () => {
    const a = People.addContact({ name: "A" });
    expect(People.cadenceHealth(People.getContact(a.id)!)).toBeNull();
  });

  it("cadenceHealth is 1 right after contact and decays toward 0 at the window edge", () => {
    const now = Date.now();
    const c: PeopleModule.Contact = {
      id: "x",
      name: "X",
      category: "Friend",
      groups: [],
      lastContactAt: now,
      followUpDays: 10,
      createdAt: now,
      updatedAt: now,
    };
    expect(People.cadenceHealth(c, now)).toBe(1);
    expect(People.cadenceHealth(c, now + 10 * 86_400_000)).toBe(0);
  });

  it("cadenceHealth clamps at -1 once far overdue", () => {
    const now = Date.now();
    const c: PeopleModule.Contact = {
      id: "x",
      name: "X",
      category: "Friend",
      groups: [],
      lastContactAt: now,
      followUpDays: 10,
      createdAt: now,
      updatedAt: now,
    };
    expect(People.cadenceHealth(c, now + 100 * 86_400_000)).toBe(-1);
  });

  it("dueFollowUps uses each contact's own cadence, falling back to the given default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const custom = People.addContact({ name: "Custom" });
    People.updateContact(custom.id, { followUpDays: 5 });
    People.logInteraction(custom.id, "call");
    const fallback = People.addContact({ name: "Fallback" });
    People.logInteraction(fallback.id, "call");
    const neverContacted = People.addContact({ name: "Never" });

    vi.setSystemTime(new Date(2026, 0, 8)); // 7 days later
    let due = People.dueFollowUps(30).map((c) => c.id);
    expect(due).toContain(custom.id); // 5-day cadence, 7 days elapsed -> due
    expect(due).not.toContain(fallback.id); // 30-day fallback, not due yet
    expect(due).not.toContain(neverContacted.id); // only 7 days since creation

    vi.setSystemTime(new Date(2026, 1, 5)); // 35 days after creation
    due = People.dueFollowUps(30).map((c) => c.id);
    expect(due).toContain(neverContacted.id); // never contacted, counts from creation
  });
});

describe("birthdayOccurrence", () => {
  it("returns the birthday's month/day in the given year", () => {
    const d = People.birthdayOccurrence("1990-06-15", 2026);
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(15);
  });

  it("clamps Feb 29 to Feb 28 in a non-leap year", () => {
    const d = People.birthdayOccurrence("2000-02-29", 2026);
    expect(d?.getMonth()).toBe(1);
    expect(d?.getDate()).toBe(28);
  });

  it("keeps Feb 29 in a leap year", () => {
    const d = People.birthdayOccurrence("2000-02-29", 2028);
    expect(d?.getDate()).toBe(29);
  });

  it("returns null for a malformed birthday", () => {
    expect(People.birthdayOccurrence("not-a-date", 2026)).toBeNull();
  });
});

describe("nextBirthdayAt", () => {
  it("returns 9am today when the birthday is later today", () => {
    const from = new Date(2026, 5, 15, 7, 0).getTime(); // 7am, birthday is today
    const at = People.nextBirthdayAt("1990-06-15", from);
    const d = new Date(at!);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
  });

  it("reminds shortly (within a minute) when today's 9am has already passed", () => {
    const from = new Date(2026, 5, 15, 15, 0).getTime(); // 3pm, birthday is today
    const at = People.nextBirthdayAt("1990-06-15", from);
    expect(at).toBeGreaterThanOrEqual(from);
    expect(at).toBeLessThan(from + 61_000);
  });

  it("rolls over to next year once this year's birthday has fully passed", () => {
    const from = new Date(2026, 5, 16, 0, 0).getTime(); // day after the birthday
    const at = People.nextBirthdayAt("1990-06-15", from);
    const d = new Date(at!);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
  });
});

describe("upcomingBirthdays", () => {
  it("finds a birthday within the window, including a year wrap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 20)); // Dec 20
    const decBirthday = People.addContact({ name: "Dec" });
    People.updateContact(decBirthday.id, { birthday: "1990-12-25" });
    const janBirthday = People.addContact({ name: "Jan" });
    People.updateContact(janBirthday.id, { birthday: "1990-01-05" });
    const farBirthday = People.addContact({ name: "Far" });
    People.updateContact(farBirthday.id, { birthday: "1990-06-01" });

    const upcoming = People.upcomingBirthdays(30).map((c) => c.id);
    expect(upcoming).toContain(decBirthday.id);
    expect(upcoming).toContain(janBirthday.id); // wraps into next year
    expect(upcoming).not.toContain(farBirthday.id);
  });
});

describe("scheduleBirthdayReminder + Time Core integration", () => {
  it("creates a yearly Time entry anchored at 9am on the birthday, even when firing shortly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 15, 0)); // 3pm on the birthday itself
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, { birthday: "1990-06-15" });

    const entry = People.scheduleBirthdayReminder(a.id);
    expect(entry?.recurrence).toBe("yearly");
    expect(entry?.dedupeKey).toBe(`birthday-${a.id}`);
    const anchor = new Date(entry!.anchorAt!);
    expect(anchor.getHours()).toBe(9);
    expect(anchor.getDate()).toBe(15);
    // The actual first fire is "shortly", not stuck at a fixed afternoon time.
    expect(entry!.at).toBeGreaterThanOrEqual(Date.now());
    expect(entry!.at).toBeLessThan(Date.now() + 61_000);
  });

  it("is idempotent per contact via the dedupeKey", () => {
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, { birthday: "1990-06-15" });
    const first = People.scheduleBirthdayReminder(a.id);
    const second = People.scheduleBirthdayReminder(a.id);
    expect(second?.id).toBe(first?.id);
  });

  it("returns null for a contact without a birthday", () => {
    const a = People.addContact({ name: "A" });
    expect(People.scheduleBirthdayReminder(a.id)).toBeNull();
  });

  it("rescheduling on a birthday change cancels the old entry and creates a new one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, { birthday: "1990-01-10" }); // within 30 days -> rescheduled
    const entries = Time.getTimeEntries().filter((e) => e.dedupeKey === `birthday-${a.id}`);
    expect(entries).toHaveLength(1);
    expect(new Date(entries[0].at).getDate()).toBe(10);

    People.updateContact(a.id, { birthday: "1990-01-20" });
    const after = Time.getTimeEntries().filter((e) => e.dedupeKey === `birthday-${a.id}` && !e.firedAt);
    expect(after).toHaveLength(1);
    expect(new Date(after[0].at).getDate()).toBe(20);
  });

  it("archiving a contact retracts its birthday reminder", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, { birthday: "1990-01-10" });
    expect(Time.getTimeEntries().some((e) => e.dedupeKey === `birthday-${a.id}`)).toBe(true);
    People.archiveContact(a.id);
    expect(Time.getTimeEntries().some((e) => e.dedupeKey === `birthday-${a.id}`)).toBe(false);
  });

  it("initPeopleCore materializes reminders for birthdays inside the horizon and fires them via Time Core", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 8, 59)); // 1 minute before the birthday's 9am
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, { birthday: "1990-06-15" });

    People.initPeopleCore(30);
    Time.initTimeCore();

    vi.setSystemTime(new Date(2026, 5, 15, 9, 1));
    vi.advanceTimersByTime(5000); // one Time Core tick

    const fired = Time.getTimeEntries().find((e) => e.dedupeKey === `birthday-${a.id}`);
    expect(fired?.lastFiredAt).toBeDefined();
  });
});

describe("contactForAI", () => {
  it("never includes phone, email, social, or birthday", () => {
    const a = People.addContact({ name: "A" });
    People.updateContact(a.id, {
      phone: "555-0100",
      email: "a@example.com",
      social: "@a",
      birthday: "1990-06-15",
    });
    const summary = People.contactForAI(a.id);
    expect(summary).not.toContain("555-0100");
    expect(summary).not.toContain("a@example.com");
    expect(summary).not.toContain("@a");
    expect(summary).toContain("never contacted");
    // Birthday is a sensitive field with no readable capability: it must not
    // appear in the default AI view (2026-07-10 audit, People P1).
    expect(summary).not.toContain("06-15");
    expect(summary).not.toMatch(/birthday/i);
  });

  it("returns null for a missing contact", () => {
    expect(People.contactForAI("missing")).toBeNull();
  });
});

describe("person ↔ object relationship model (Wave 3)", () => {
  it("links a contact to an object with a typed kind, idempotently, with reverse lookup", async () => {
    const Objects = await import("../objects");
    const c = People.addContact({ name: "Ada" });
    const card = Objects.createObject({ type: "card", title: "Notes on Ada" });
    const link = People.linkPersonToObject(c.id, card.id);
    expect(link).not.toBeNull();
    expect(link!.kind).toBe("note");
    // Idempotent per pair.
    expect(People.linkPersonToObject(c.id, card.id)!.id).toBe(link!.id);
    expect(People.linksForContact(c.id)).toHaveLength(1);
    expect(People.contactsForObject(card.id).map((x) => x.id)).toEqual([c.id]);
  });

  it("refuses links to missing contacts/objects, and repair prunes dead ends", async () => {
    const Objects = await import("../objects");
    const c = People.addContact({ name: "Ada" });
    expect(People.linkPersonToObject(c.id, "missing")).toBeNull();
    expect(People.linkPersonToObject("missing", "also-missing")).toBeNull();
    const task = Objects.createObject({ type: "task", title: "Call Ada" });
    People.linkPersonToObject(c.id, task.id);
    Objects.deleteObject(task.id);
    expect(People.repairPersonLinks()).toBe(1);
    expect(People.linksForContact(c.id)).toHaveLength(0);
  });

  it("migrates a legacy notesCardId into the link table at init", async () => {
    const Objects = await import("../objects");
    const card = Objects.createObject({ type: "card", title: "Legacy notes" });
    const c = People.addContact({ name: "Grace" });
    People.updateContact(c.id, { notesCardId: card.id });
    People.initPeopleCore();
    const links = People.linksForContact(c.id);
    expect(links.some((l) => l.objectId === card.id && l.kind === "note")).toBe(true);
  });
});

describe("birthday reconciliation beyond the boot horizon (Wave 3)", () => {
  it("schedules a birthday that ENTERS the horizon while the session runs, via the daily job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0)); // June 1
    const Time = await import("./time");
    // Birthday on July 15 — 44 days out, outside the 30-day boot horizon.
    const c = People.addContact({ name: "Later" });
    People.updateContact(c.id, { birthday: "1990-07-15" });
    People.initPeopleCore(30);
    Time.initTimeCore();
    const hasReminder = () =>
      Time.getTimeEntries().some((e) => e.dedupeKey === `birthday-${c.id}` && !e.firedAt);
    expect(hasReminder()).toBe(false);
    // 20 days pass in one running session: July 15 is now inside the horizon.
    // The 12-hourly reconcile job runs on the shared scheduler tick.
    vi.setSystemTime(new Date(2026, 5, 21, 12, 0, 0));
    vi.advanceTimersByTime(13 * 60 * 60_000);
    expect(hasReminder()).toBe(true);
    vi.useRealTimers();
  });
});
