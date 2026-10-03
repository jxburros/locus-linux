import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SearchModule from "./searchIndex";
import type * as ObjectsModule from "../objects";
import type * as CardspokeModule from "./cardspoke";
import type * as PeopleModule from "./people";

let Search: typeof SearchModule;
let Objects: typeof ObjectsModule;
let Cardspoke: typeof CardspokeModule;
let People: typeof PeopleModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Search = await import("./searchIndex");
  Objects = await import("../objects");
  Cardspoke = await import("./cardspoke");
  People = await import("./people");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseQuery", () => {
  it("splits free text from filters", () => {
    const q = Search.parseQuery("hello type:task world");
    expect(q.text).toBe("hello world");
    expect(q.type).toBe("task");
    expect(q.errors).toHaveLength(0);
  });

  it("tolerates a space after the colon", () => {
    const q = Search.parseQuery("before: 2026-08-01");
    expect(q.before).toBe("2026-08-01");
  });

  it("does not let a dangling filter swallow the next filter token", () => {
    const q = Search.parseQuery("before: after: 2026-01-01");
    expect(q.errors.some((e) => e.includes("before:"))).toBe(true);
    expect(q.after).toBe("2026-01-01");
  });

  it("reports an unknown type instead of silently ignoring it", () => {
    const q = Search.parseQuery("type:bogus");
    expect(q.type).toBeUndefined();
    expect(q.errors[0]).toContain("bogus");
  });

  it("reports a malformed date instead of silently ignoring it", () => {
    const q = Search.parseQuery("before:not-a-date");
    expect(q.before).toBeUndefined();
    expect(q.errors[0]).toContain("before:");
  });

  it("strips a leading # from a tag filter and lowercases it", () => {
    const q = Search.parseQuery("tag:#Work");
    expect(q.tag).toBe("work");
  });

  it("errors when a trailing filter has no value at all", () => {
    const q = Search.parseQuery("hello type:");
    expect(q.errors[0]).toContain("type:");
  });
});

describe("searchAll", () => {
  it("returns nothing for an empty query with no filters", () => {
    const result = Search.searchAll("   ");
    expect(result).toEqual({ apps: [], objects: [], contacts: [], errors: [] });
  });

  it("matches apps by name/description/keywords", () => {
    const result = Search.searchAll("tasks");
    expect(result.apps.some((a) => a.id === "tasks")).toBe(true);
  });

  it("matches contacts by name", () => {
    People.addContact({ name: "Ada Lovelace" });
    const result = Search.searchAll("lovelace");
    expect(result.contacts.map((c) => c.name)).toEqual(["Ada Lovelace"]);
  });

  it("finds objects by title/body text", () => {
    Objects.createObject({ type: "document", title: "Quarterly Plan", body: "budget details" });
    const result = Search.searchAll("quarterly");
    expect(result.objects).toHaveLength(1);
  });

  it("excludes deliberately-excluded objects from every path", () => {
    const doc = Objects.createObject({ type: "document", title: "Secret plan" });
    Objects.updateObject(doc.id, { indexState: "excluded" }, { silent: true });
    expect(Search.searchAll("secret").objects).toHaveLength(0);
  });

  it("excludes trashed files", async () => {
    const Files = await import("./files");
    const f = Files.addFileEntry({ title: "Old report", kind: "doc" });
    Files.trashFile(f.id);
    expect(Search.searchAll("report").objects).toHaveLength(0);
  });

  it("supports filter-only queries (no free text), listing matching objects", () => {
    Cardspoke.createCard({ type: "task", title: "T1", tags: ["work"] });
    Cardspoke.createCard({ type: "card", title: "C1", tags: ["work"] });
    const result = Search.searchAll("type:task tag:work");
    expect(result.objects.map((h) => h.object.title)).toEqual(["T1"]);
  });

  it("surfaces filter-grammar errors instead of just returning empty results", () => {
    const result = Search.searchAll("type:bogus");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("applies date filters against local calendar days, inclusive", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15));
    const doc = Objects.createObject({ type: "document", title: "Doc" });
    const result = Search.searchAll(`type:document after:2026-06-15 before:2026-06-15`);
    expect(result.objects.map((h) => h.object.id)).toEqual([doc.id]);
  });

  it("ranks a recently-updated hit ahead of an older one with a weaker text match", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    Objects.createObject({ type: "document", title: "apple pie apple apple", body: "" }); // strong match, old
    vi.setSystemTime(new Date(2026, 0, 11)); // 10 days later — old doc is now outside the recency window
    const recent = Objects.createObject({ type: "document", title: "just apple", body: "" }); // weaker match, fresh
    const result = Search.searchAll("apple");
    expect(result.objects[0].object.id).toBe(recent.id);
  });
});

describe("recentObjects", () => {
  it("sorts by updatedAt descending and excludes excluded/trashed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const a = Objects.createObject({ type: "document", title: "A" });
    vi.advanceTimersByTime(1000);
    const b = Objects.createObject({ type: "document", title: "B" });
    vi.advanceTimersByTime(1000);
    const Files = await import("./files");
    const f = Files.addFileEntry({ title: "F", kind: "doc" });
    Files.trashFile(f.id);

    const recent = Search.recentObjects(10).map((o) => o.id);
    expect(recent).toEqual([b.id, a.id]);
  });
});

describe("relationshipsFor", () => {
  it("combines links, backlinks, project siblings, and tag neighbors, deduped", () => {
    const target = Cardspoke.createCard({ type: "card", title: "Target", tags: ["x"] });
    const linked = Cardspoke.createCard({ type: "card", title: "Linked" });
    Cardspoke.linkCards(target.id, linked.id);
    const backlinker = Cardspoke.createCard({
      type: "card",
      title: "Backlinker",
      body: "[[Target]]",
    });
    const sibling = Objects.createObject({
      type: "document",
      title: "Sibling",
      projectIds: ["p1"],
    });
    Objects.updateObject(target.id, { projectIds: ["p1"] }, { silent: true });
    const tagNeighbor = Cardspoke.createCard({ type: "card", title: "Tag neighbor", tags: ["x"] });

    const rel = Search.relationshipsFor(target.id);
    const ids = rel.map((r) => r.object.id);
    expect(ids).toContain(linked.id);
    expect(ids).toContain(backlinker.id);
    expect(ids).toContain(sibling.id);
    expect(ids).toContain(tagNeighbor.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(rel.find((r) => r.object.id === linked.id)?.via).toBe("linked");
  });

  it("returns an empty list for a missing object", () => {
    expect(Search.relationshipsFor("missing")).toEqual([]);
  });

  it("excludes an excluded or trashed related object", () => {
    const target = Cardspoke.createCard({ type: "card", title: "Target" });
    const linked = Cardspoke.createCard({ type: "card", title: "Linked" });
    Cardspoke.linkCards(target.id, linked.id);
    Objects.updateObject(linked.id, { indexState: "excluded" }, { silent: true });
    expect(Search.relationshipsFor(target.id)).toHaveLength(0);
  });
});

describe("safeSnippet / safeSourceLabel", () => {
  it("redacts, collapses whitespace, and truncates with an ellipsis", () => {
    const text = `line one\nline   two ${"x".repeat(200)}`;
    const snippet = Search.safeSnippet(text, 20);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).not.toContain("\n");
  });

  it("redacts a secret embedded in text", () => {
    expect(Search.safeSnippet("key sk-ABCDEFGHIJKLMNOPQRSTUVWX")).toContain(
      "[redacted: OpenAI key]",
    );
  });

  it("safeSourceLabel redacts the title and falls back to Untitled", () => {
    const doc = Objects.createObject({ type: "document", title: "" });
    expect(Search.safeSourceLabel(doc)).toContain("Untitled");
  });

  it("safeSourceLabel redacts a secret embedded in the title itself", () => {
    const doc = Objects.createObject({
      type: "document",
      title: "key sk-ABCDEFGHIJKLMNOPQRSTUVWX",
    });
    expect(Search.safeSourceLabel(doc)).toContain("[redacted: OpenAI key]");
  });
});

describe("buildContextSnippets", () => {
  it("falls back to the title when the body is an empty string", () => {
    Objects.createObject({ type: "document", title: "findme-unique", body: "" });
    const snippets = Search.buildContextSnippets("findme-unique");
    expect(snippets[0].text).toBe("findme-unique");
  });

  it("caps results at the given limit", () => {
    for (let i = 0; i < 10; i++) {
      Objects.createObject({ type: "document", title: `findme-cap-${i}`, body: "findme-cap" });
    }
    expect(Search.buildContextSnippets("findme-cap", 3)).toHaveLength(3);
  });
});

describe("exclusion provenance (Wave 3)", () => {
  it("lifts a source-pattern exclusion when the pattern is removed, on the next full pass", async () => {
    const Indexing = await import("../indexing");
    const Sources = await import("../sources");
    Sources.seedIfEmpty();
    const doc = Objects.createObject({ type: "document", title: "secret-notes", body: "x" });
    Sources.addExclusion("local", "secret-*");
    Indexing.runIndex("local");
    expect(Objects.getObject(doc.id)?.indexState).toBe("excluded");
    expect(Objects.getObject(doc.id)?.excludedBy).toBe("source-pattern");
    // The pattern is removed: the next full pass may lift ITS OWN exclusion.
    Sources.removeExclusion("local", "secret-*");
    Indexing.runIndex("local");
    expect(Objects.getObject(doc.id)?.indexState).toBe("indexed");
    expect(Objects.getObject(doc.id)?.excludedBy).toBeUndefined();
  });

  it("never lifts a USER exclusion or trash state in a full pass", async () => {
    const Indexing = await import("../indexing");
    const Sources = await import("../sources");
    Sources.seedIfEmpty();
    const userExcluded = Objects.createObject({ type: "document", title: "private", body: "x" });
    Objects.setIndexState(userExcluded.id, "excluded");
    const trashed = Objects.createObject({ type: "card", title: "old", body: "y" });
    Objects.trashObject(trashed.id);
    Indexing.runIndex("local");
    expect(Objects.getObject(userExcluded.id)?.indexState).toBe("excluded");
    expect(Objects.getObject(userExcluded.id)?.excludedBy).toBe("user");
    expect(Objects.getObject(trashed.id)?.indexState).toBe("excluded");
    expect(Objects.getObject(trashed.id)?.excludedBy).toBe("trash");
  });
});

describe("retrieveForAI / relationshipsForAI (Wave 3)", () => {
  it("returns redacted DTOs, never raw objects, and withholds unreadable sources", async () => {
    const Sources = await import("../sources");
    Sources.seedIfEmpty();
    const key = "sk-abcdefghijklmnopqrstuvwxyz1234";
    Objects.createObject({
      type: "card",
      title: `token ${key}`,
      body: `the key is ${key}`,
      tags: [key],
    });
    const items = Search.retrieveForAI("token");
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(JSON.stringify(item)).not.toContain(key);
    expect(item.title).toContain("[redacted");
    expect(item.tags[0]).toContain("[redacted");
    // DTO shape only — no body, no raw SystemObject fields.
    expect(item).not.toHaveProperty("body");
    expect(item).not.toHaveProperty("object");

    // Disable the source's reading: AI retrieval goes empty; user search still works.
    Sources.setReadable("local", false);
    expect(Search.retrieveForAI("token")).toHaveLength(0);
    expect(Search.searchAll("token").objects.length).toBeGreaterThan(0);
  });

  it("relationshipsForAI redacts and authorizes what relationshipsFor returns raw", async () => {
    const Sources = await import("../sources");
    Sources.seedIfEmpty();
    const a = Objects.createObject({ type: "card", title: "Alpha", body: "", tags: ["shared"] });
    const b = Objects.createObject({
      type: "card",
      title: "Beta sk-abcdefghijklmnopqrstuvwxyz1234",
      body: "",
      tags: ["shared"],
    });
    const related = Search.relationshipsForAI(a.id);
    expect(related.some((r) => r.item.objectId === b.id)).toBe(true);
    const hit = related.find((r) => r.item.objectId === b.id)!;
    expect(hit.item.title).toContain("[redacted");
    expect(hit.via).toBeTruthy();
  });
});
