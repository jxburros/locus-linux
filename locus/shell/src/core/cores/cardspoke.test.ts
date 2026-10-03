import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as CardspokeModule from "./cardspoke";
import type * as ObjectsModule from "../objects";

let Cardspoke: typeof CardspokeModule;
let Objects: typeof ObjectsModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Cardspoke = await import("./cardspoke");
  Objects = await import("../objects");
});

describe("createCard / inline tags", () => {
  it("extracts #inline-tags from the body and merges with explicit tags", () => {
    const card = Cardspoke.createCard({
      type: "card",
      title: "Note",
      body: "about #work and #ideas",
      tags: ["important"],
    });
    expect(card.tags).toEqual(["important", "work", "ideas"]);
  });

  it("caps inline tags at 5 and dedupes case-insensitively", () => {
    const card = Cardspoke.createCard({
      type: "card",
      title: "Note",
      body: "#a #A #b #c #d #e #f",
    });
    expect(card.tags).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("creates a task with default priority and due date", () => {
    const task = Cardspoke.createCard({ type: "task", title: "Ship it", due: "2026-08-01" });
    expect(task.task).toEqual({ done: false, priority: "normal", due: "2026-08-01" });
  });
});

describe("updateCard — inline tag resync", () => {
  it("removes tags whose #inline source was deleted from the body, keeps manual tags", () => {
    const card = Cardspoke.createCard({
      type: "card",
      title: "Note",
      body: "about #foo #bar",
      tags: ["important"],
    });
    expect(card.tags).toEqual(["important", "foo", "bar"]);

    const updated = Cardspoke.updateCard(card.id, { body: "about #foo #baz" });
    expect(updated?.tags).toEqual(["important", "foo", "baz"]);
  });

  it("does not touch tags when the body is not part of the patch", () => {
    const card = Cardspoke.createCard({ type: "card", title: "Note", body: "#foo", tags: [] });
    const updated = Cardspoke.updateCard(card.id, { title: "Renamed" });
    expect(updated?.tags).toEqual(["foo"]);
  });

  it("returns undefined for a missing id", () => {
    expect(Cardspoke.updateCard("missing", { title: "x" })).toBeUndefined();
  });
});

describe("wiki-links", () => {
  it("parses [[Title]] tokens with position info", () => {
    const links = Cardspoke.parseWikiLinks("see [[Project Plan]] for details");
    expect(links).toEqual([
      { match: "[[Project Plan]]", title: "Project Plan", startIndex: 4, endIndex: 20 },
    ]);
  });

  it("resolves the inner link when brackets are tripled", () => {
    const links = Cardspoke.parseWikiLinks("[[[Title]]]");
    expect(links).toHaveLength(1);
    expect(links[0].title).toBe("Title");
  });

  it("hasWikiLink matches case- and whitespace-insensitively", () => {
    expect(Cardspoke.hasWikiLink("see [[ Project   Plan ]]", "project plan")).toBe(true);
  });

  it("findByTitle resolves the most recently updated object on a title collision", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const a = Cardspoke.createCard({ type: "card", title: "Dup" });
    vi.advanceTimersByTime(1);
    const b = Cardspoke.createCard({ type: "card", title: "Dup" });
    // Make `a` the more recently updated one, opposite of creation order, so
    // this genuinely exercises the updatedAt tie-break rather than relying
    // on incidental storage order.
    vi.advanceTimersByTime(1);
    Objects.updateObject(a.id, { title: "Dup" });
    const found = Cardspoke.findByTitle("dup");
    expect(found?.id).toBe(a.id);
    vi.useRealTimers();
    void b;
  });

  it("linksFor resolves both explicit card links and body wiki-links", () => {
    const target = Cardspoke.createCard({ type: "card", title: "Target" });
    const source = Cardspoke.createCard({
      type: "card",
      title: "Source",
      body: "see [[Target]]",
    });
    const links = Cardspoke.linksFor(source.id);
    expect(links.map((l) => l.id)).toEqual([target.id]);
  });

  it("backlinksFor finds objects linking in by wiki-link or explicit link", () => {
    const target = Cardspoke.createCard({ type: "card", title: "Target" });
    const viaWiki = Cardspoke.createCard({ type: "card", title: "Via wiki", body: "[[Target]]" });
    const other = Cardspoke.createCard({ type: "card", title: "Other" });
    Cardspoke.linkCards(other.id, target.id);

    const backlinks = Cardspoke.backlinksFor(target.id).map((o) => o.id).sort();
    expect(backlinks).toEqual([other.id, viaWiki.id].sort());
  });
});

describe("linkCards / unlinkCards", () => {
  it("links bidirectionally and is idempotent", () => {
    const a = Cardspoke.createCard({ type: "card", title: "A" });
    const b = Cardspoke.createCard({ type: "card", title: "B" });
    Cardspoke.linkCards(a.id, b.id);
    Cardspoke.linkCards(a.id, b.id); // second call is a no-op
    expect(Objects.getObject(a.id)?.card?.links).toEqual([b.id]);
    expect(Objects.getObject(b.id)?.card?.links).toEqual([a.id]);
  });

  it("unlinkCards removes both directions", () => {
    const a = Cardspoke.createCard({ type: "card", title: "A" });
    const b = Cardspoke.createCard({ type: "card", title: "B" });
    Cardspoke.linkCards(a.id, b.id);
    Cardspoke.unlinkCards(a.id, b.id);
    expect(Objects.getObject(a.id)?.card?.links).toEqual([]);
    expect(Objects.getObject(b.id)?.card?.links).toEqual([]);
  });

  it("does nothing for non-card-typed objects", () => {
    const doc = Cardspoke.createCard({ type: "document", title: "Doc" });
    const card = Cardspoke.createCard({ type: "card", title: "Card" });
    Cardspoke.linkCards(doc.id, card.id);
    expect(Objects.getObject(card.id)?.card?.links).toEqual([]);
  });
});

describe("relatedByTags", () => {
  it("ranks matches by shared-tag score, best first", () => {
    const target = Cardspoke.createCard({ type: "card", title: "T", tags: ["a", "b", "c"] });
    const closeMatch = Cardspoke.createCard({ type: "card", title: "Close", tags: ["a", "b"] });
    const farMatch = Cardspoke.createCard({ type: "card", title: "Far", tags: ["a"] });
    Cardspoke.createCard({ type: "card", title: "Unrelated", tags: ["z"] });

    const related = Cardspoke.relatedByTags(target.id);
    expect(related.map((r) => r.object.id)).toEqual([closeMatch.id, farMatch.id]);
  });

  it("returns nothing for an object with no tags", () => {
    const target = Cardspoke.createCard({ type: "card", title: "T" });
    expect(Cardspoke.relatedByTags(target.id)).toEqual([]);
  });
});

describe("status setters", () => {
  it("setCardStatus / setCardPriority / setCardDue only affect task-typed objects", () => {
    const task = Cardspoke.createCard({ type: "task", title: "T" });
    Cardspoke.setCardStatus(task.id, true);
    Cardspoke.setCardPriority(task.id, "high");
    Cardspoke.setCardDue(task.id, "2026-09-01");
    const updated = Objects.getObject(task.id);
    expect(updated?.task).toEqual({ done: true, priority: "high", due: "2026-09-01" });

    const doc = Cardspoke.createCard({ type: "document", title: "Doc" });
    Cardspoke.setCardStatus(doc.id, true); // no task field — no-op, must not throw
    expect(Objects.getObject(doc.id)?.task).toBeUndefined();
  });
});

describe("convert / revert", () => {
  it("round-trips a task through card and back, restoring due/done", () => {
    const task = Cardspoke.createCard({ type: "task", title: "T", due: "2026-08-01" });
    Cardspoke.setCardStatus(task.id, true);
    const asCard = Cardspoke.convertCard(task.id, "card");
    expect(asCard?.type).toBe("card");
    expect(asCard?.task).toBeUndefined();

    const back = Cardspoke.revertConversion(task.id);
    expect(back?.type).toBe("task");
    expect(back?.task).toEqual({ done: true, priority: "normal", due: "2026-08-01" });
  });

  it("revertConversion is undefined for an object that was never converted", () => {
    const card = Cardspoke.createCard({ type: "card", title: "Card" });
    expect(Cardspoke.revertConversion(card.id)).toBeUndefined();
  });

  it("multi-hop task→card→document→task restores the original task state (2026-07-10 audit)", () => {
    const task = Cardspoke.createCard({ type: "task", title: "T", due: "2026-08-01" });
    Cardspoke.setCardStatus(task.id, true);
    Cardspoke.setCardPriority(task.id, "high");
    Cardspoke.convertCard(task.id, "card");
    Cardspoke.convertCard(task.id, "document");
    const backToTask = Cardspoke.convertCard(task.id, "task");
    expect(backToTask?.type).toBe("task");
    // The single previousShape used to be overwritten each hop, losing this.
    expect(backToTask?.task).toEqual({ done: true, priority: "high", due: "2026-08-01" });
  });
});

describe("ownership guards (2026-07-10 audit)", () => {
  it("updateCard/deleteCard/convertCard refuse a non-Cardspoke (file) object", () => {
    const file = Objects.createObject({
      type: "file",
      title: "cover.png",
      file: { kind: "image", ref: "/cover.png" },
    });
    expect(Cardspoke.updateCard(file.id, { title: "hacked" })).toBeUndefined();
    expect(Cardspoke.convertCard(file.id, "task")).toBeUndefined();
    Cardspoke.deleteCard(file.id);
    // The file must still exist — Cardspoke may not hard-delete Files' objects.
    expect(Objects.getObject(file.id)).toBeDefined();
    expect(Objects.getObject(file.id)?.title).toBe("cover.png");
  });
});

describe("outline -> tasks conversion", () => {
  it("extracts bullet and numbered lines as task titles, ignoring hr/emphasis", () => {
    const doc = Cardspoke.createCard({
      type: "document",
      title: "Plan",
      body: ["- Buy milk", "* Call Sam", "1. Ship it", "---", "*emphasis only*", "not a bullet"].join(
        "\n",
      ),
      tags: ["home"],
    });
    const created = Cardspoke.convertOutlineToTasks(doc.id);
    expect(created.map((t) => t.title)).toEqual(["Buy milk", "Call Sam", "Ship it"]);
    expect(created.every((t) => t.tags.includes("home"))).toBe(true);
  });

  it("is idempotent — running it twice does not duplicate tasks", () => {
    const doc = Cardspoke.createCard({ type: "document", title: "Plan", body: "- Buy milk" });
    Cardspoke.convertOutlineToTasks(doc.id);
    const second = Cardspoke.convertOutlineToTasks(doc.id);
    expect(second).toHaveLength(0);
    expect(Objects.allObjects().filter((o) => o.type === "task")).toHaveLength(1);
  });

  it("recognizes a checkbox bullet and strips the checkbox marker", () => {
    const doc = Cardspoke.createCard({ type: "document", title: "Plan", body: "- [ ] Do the thing" });
    const created = Cardspoke.convertOutlineToTasks(doc.id);
    expect(created.map((t) => t.title)).toEqual(["Do the thing"]);
  });
});

describe("typed queries", () => {
  it("tasksDueToday / overdueTasks partition by local date, excluding done tasks", () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dueToday = Cardspoke.createCard({ type: "task", title: "Today", due: todayStr });
    const overdue = Cardspoke.createCard({ type: "task", title: "Overdue", due: "2000-01-01" });
    const doneOverdue = Cardspoke.createCard({ type: "task", title: "Done overdue", due: "2000-01-01" });
    Cardspoke.setCardStatus(doneOverdue.id, true);

    expect(Cardspoke.tasksDueToday().map((t) => t.id)).toEqual([dueToday.id]);
    expect(Cardspoke.overdueTasks().map((t) => t.id)).toEqual([overdue.id]);
  });

  it("findByTypeAndTag matches by type and normalized tag", () => {
    const card = Cardspoke.createCard({ type: "card", title: "C", tags: ["work"] });
    Cardspoke.createCard({ type: "task", title: "T", tags: ["work"] });
    expect(Cardspoke.findByTypeAndTag("card", "#Work").map((o) => o.id)).toEqual([card.id]);
  });
});

describe("evaluateFilter / saved filters", () => {
  it("AND-combines type, tag, done, dueBefore, projectId", () => {
    const match = Cardspoke.createCard({
      type: "task",
      title: "Match",
      tags: ["work"],
      due: "2026-01-01",
      projectIds: ["p1"],
    });
    Cardspoke.createCard({ type: "task", title: "Wrong tag", tags: ["home"], due: "2026-01-01" });
    Cardspoke.createCard({
      type: "task",
      title: "Too late",
      tags: ["work"],
      due: "2027-01-01",
      projectIds: ["p1"],
    });

    const hits = Cardspoke.evaluateFilter({
      type: "task",
      tag: "work",
      done: false,
      dueBefore: "2026-06-01",
      projectId: "p1",
    });
    expect(hits.map((h) => h.id)).toEqual([match.id]);
  });

  it("persists a named filter and can remove it", () => {
    const saved = Cardspoke.saveFilter("My filter", { type: "task", done: false });
    expect(Cardspoke.listSavedFilters().map((f) => f.id)).toEqual([saved.id]);
    Cardspoke.removeSavedFilter(saved.id);
    expect(Cardspoke.listSavedFilters()).toHaveLength(0);
  });

  it("defaults an empty saved filter name to 'Untitled filter'", () => {
    const saved = Cardspoke.saveFilter("   ", {});
    expect(saved.name).toBe("Untitled filter");
  });
});

describe("cardForAI", () => {
  it("summarizes type, status, tags, and relationships", () => {
    const target = Cardspoke.createCard({ type: "card", title: "Target" });
    const task = Cardspoke.createCard({
      type: "task",
      title: "Follow up",
      due: "2026-08-01",
      tags: ["work"],
      body: "see [[Target]]",
    });
    const summary = Cardspoke.cardForAI(task.id);
    expect(summary).toContain("task:");
    expect(summary).toContain("open, due 2026-08-01");
    expect(summary).toContain("tags: work");
    expect(summary).toContain("links to: Target");
    void target;
  });

  it("returns null for a non-Cardspoke object or missing id", () => {
    expect(Cardspoke.cardForAI("missing")).toBeNull();
  });
});

describe("generic trash / recovery (Wave 3)", () => {
  it("deleteCard trashes recoverably: gone from listings, restorable intact", () => {
    const card = Cardspoke.createCard({ type: "card", title: "Keep me", body: "important" });
    Cardspoke.deleteCard(card.id);
    expect(Cardspoke.allCards().map((c) => c.id)).not.toContain(card.id);
    expect(Cardspoke.trashedCards().map((c) => c.id)).toContain(card.id);
    Cardspoke.restoreCard(card.id);
    expect(Cardspoke.allCards().map((c) => c.id)).toContain(card.id);
    const restored = Cardspoke.allCards().find((c) => c.id === card.id)!;
    expect(restored.body).toBe("important");
    expect(restored.trashedAt).toBeUndefined();
  });

  it("trashed tasks leave the typed queries", () => {
    const t = Cardspoke.createCard({ type: "task", title: "Overdue", due: "2020-01-01" });
    expect(Cardspoke.overdueTasks().map((x) => x.id)).toContain(t.id);
    Cardspoke.deleteCard(t.id);
    expect(Cardspoke.overdueTasks().map((x) => x.id)).not.toContain(t.id);
  });

  it("purgeCardTrash requires a valid one-shot confirmation token", () => {
    const card = Cardspoke.createCard({ type: "card", title: "Doomed" });
    Cardspoke.deleteCard(card.id);
    expect(Cardspoke.purgeCardTrash("bogus")).toBe(0);
    expect(Cardspoke.trashedCards()).toHaveLength(1);
    const { token, count } = Cardspoke.requestCardTrashPurge();
    expect(count).toBe(1);
    expect(Cardspoke.purgeCardTrash(token)).toBe(1);
    expect(Cardspoke.trashedCards()).toHaveLength(0);
    // Replay destroys nothing.
    const again = Cardspoke.createCard({ type: "card", title: "Second" });
    Cardspoke.deleteCard(again.id);
    expect(Cardspoke.purgeCardTrash(token)).toBe(0);
  });
});

describe("backlink/wiki-link symmetry (Wave 3)", () => {
  it("with duplicate titles, only the object [[Title]] resolves to reports the backlink", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const older = Cardspoke.createCard({ type: "card", title: "Same Name" });
    vi.advanceTimersByTime(10);
    const newer = Cardspoke.createCard({ type: "card", title: "Same Name" });
    vi.advanceTimersByTime(10);
    const linker = Cardspoke.createCard({ type: "card", title: "Linker", body: "see [[Same Name]]" });
    // Resolution is deterministic: most recently updated wins.
    const resolved = Cardspoke.resolveWikiLinks(linker.body);
    expect(resolved[0].objectId).toBe(newer.id);
    // Backlinks agree exactly with resolution — the older duplicate reports none.
    expect(Cardspoke.backlinksFor(newer.id).map((o) => o.id)).toContain(linker.id);
    expect(Cardspoke.backlinksFor(older.id).map((o) => o.id)).not.toContain(linker.id);
    vi.useRealTimers();
  });
});
