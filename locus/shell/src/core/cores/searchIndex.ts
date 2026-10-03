/*
 * Search / Index Core — OS-wide search (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: search, indexing, source metadata, ranking, recents, relationship
 * discovery, and redaction-aware retrieval. All user-authorized context is
 * findable through one path — apps, objects, files, contacts — and no app
 * builds a private index unless it reports into this one. Deep indexing
 * (summaries, refresh schedules) stays in core/indexing.ts; this Core is the
 * query surface over it all.
 *
 * The query grammar carries filters inline — `type:task tag:core before:
 * 2026-08-01 after:2026-01-01` — and ranking blends match position with
 * recency. Objects marked `excluded` never leave the index, trashed files
 * never surface, and every snippet AND source label passes redaction — a
 * key pasted into a *title* is caught, not just one in a body. AI retrieval
 * goes through buildContextSnippets; both privacy guarantees hold on every
 * path because the Search app and the assistant use these functions too.
 */

import { APPS } from "../appRegistry";
import { searchObjects, getObject, allObjects, isObjectTrashed, type SearchHit } from "../objects";
import { emit } from "../events";
import { getSource } from "../sources";
import { isExcludedNow } from "../indexing";
import { listContacts, type Contact } from "./people";
import { linksFor, backlinksFor, relatedByTags } from "./cardspoke";
import { toLocalDay, onOrAfterDay, onOrBeforeDay } from "./time";
import { redactText } from "./secrets";
import type { AppModule, ObjectType, SystemObject } from "@/types";

/** Is this object retrievable for AI context? Its source's reading must still
    be enabled — an AI gate on top of the shared exclusion/trash filters. */
function isSourceReadableForAI(o: SystemObject): boolean {
  const src = getSource(o.source);
  return !src || src.readable;
}

/* ------------------------------- query grammar ------------------------------ */

export interface ParsedQuery {
  /** Free text after filters are stripped. */
  text: string;
  type?: ObjectType;
  tag?: string;
  /** ISO dates (yyyy-mm-dd) filtering on updatedAt — local days, inclusive. */
  before?: string;
  after?: string;
  /** Human-readable problems with the filters (invalid type, bad date). */
  errors: string[];
}

const OBJECT_TYPES: ObjectType[] = ["document", "card", "task", "project", "file", "memory"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A yyyy-mm-dd string that is also a real calendar date (rejects 2026-99-99,
 *  2026-02-30, etc.) — shape alone let impossible dates through as filters. */
function isRealCalendarDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Parse `type:` / `tag:` / `before:` / `after:` filters out of a raw query.
 * Tolerates a space after the colon (`before: 2026-08-01`); invalid filter
 * values are reported in `errors` instead of silently matching nothing.
 */
export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: "", errors: [] };
  const rest: string[] = [];
  const tokens = raw.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const m = token.match(/^(type|tag|before|after):(.*)$/i);
    if (!m) {
      rest.push(token);
      continue;
    }
    const key = m[1].toLowerCase();
    let value = m[2];
    // "before: 2026-08-01" — the value landed in the next token. A token
    // that is itself a filter is not a value ("type: tag:core" must not
    // swallow the tag filter).
    if (!value && i + 1 < tokens.length && !/^(type|tag|before|after):/i.test(tokens[i + 1])) {
      value = tokens[i + 1];
      i += 1;
    }
    if (!value) {
      out.errors.push(`“${key}:” needs a value`);
      continue;
    }
    if (key === "type") {
      const t = value.toLowerCase();
      if (OBJECT_TYPES.includes(t as ObjectType)) {
        out.type = t as ObjectType;
      } else {
        out.errors.push(`Unknown type “${value}” — try ${OBJECT_TYPES.join(", ")}`);
      }
    } else if (key === "tag") {
      out.tag = value.replace(/^#/, "").toLowerCase();
    } else if (key === "before" || key === "after") {
      if (isRealCalendarDay(value)) {
        out[key] = value;
      } else {
        out.errors.push(`“${key}:” expects a real date like 2026-08-01`);
      }
    }
  }
  out.text = rest.join(" ");
  return out;
}

function matchesFilters(o: SystemObject, q: ParsedQuery): boolean {
  if (o.indexState === "excluded") return false;
  // A just-added source exclusion takes effect immediately at query time,
  // without waiting for a re-index pass to stamp the excluded state.
  if (isExcludedNow(o)) return false;
  // Both trash lifecycles are withheld: Files Core's file trash and the
  // generic object trash (cards/tasks/documents/memory).
  if (isObjectTrashed(o)) return false;
  if (q.type && o.type !== q.type) return false;
  if (q.tag && !o.tags.some((t) => t.toLowerCase() === q.tag)) return false;
  // Local calendar days, inclusive on both bounds (F2).
  const day = toLocalDay(o.updatedAt);
  if (q.before && !onOrBeforeDay(day, q.before)) return false;
  if (q.after && !onOrAfterDay(day, q.after)) return false;
  return true;
}

/* --------------------------------- ranking ---------------------------------- */

const WEEK = 7 * 86_400_000;

/** Blend match position with recency: fresher objects rank earlier. */
function rank(hits: SearchHit[]): SearchHit[] {
  const now = Date.now();
  return [...hits].sort((a, b) => {
    const boost = (h: SearchHit) => (now - h.object.updatedAt < WEEK ? -50 : 0);
    return a.score + boost(a) - (b.score + boost(b));
  });
}

/* ---------------------------------- search ---------------------------------- */

export interface UnifiedSearchResult {
  apps: AppModule[];
  objects: SearchHit[];
  contacts: Contact[];
  /** Filter-grammar problems worth showing instead of empty results. */
  errors: string[];
}

/** Search everything the OS knows, from one place. Supports inline filters. */
export function searchAll(query: string): UnifiedSearchResult {
  const parsed = parseQuery(query);
  const q = parsed.text.toLowerCase();
  const hasFilters = !!(parsed.type || parsed.tag || parsed.before || parsed.after);
  if (!q && !hasFilters) return { apps: [], objects: [], contacts: [], errors: parsed.errors };

  const apps = q
    ? APPS.filter((a) =>
        [a.name, a.description, ...(a.keywords ?? [])].join(" ").toLowerCase().includes(q),
      )
    : [];
  const contacts = q
    ? listContacts().filter((c) =>
        [c.name, c.nickname ?? "", c.category, ...c.groups].join(" ").toLowerCase().includes(q),
      )
    : [];

  // Filter-only queries list matching objects; text queries search then filter.
  const objectHits = q
    ? searchObjects(parsed.text).filter((h) => matchesFilters(h.object, parsed))
    : allObjects()
        .filter((o) => matchesFilters(o, parsed))
        .map<SearchHit>((o) => ({ object: o, score: 0, field: "title" }));

  emit("search.performed", { query, hits: objectHits.length });
  return { apps, objects: rank(objectHits), contacts, errors: parsed.errors };
}

/** Recently updated, index-visible objects — the "recents" retrieval path. */
export function recentObjects(limit = 10): SystemObject[] {
  return allObjects()
    .filter((o) => o.indexState !== "excluded" && !isObjectTrashed(o))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/* --------------------------- relationship discovery -------------------------- */

export interface Relationship {
  object: SystemObject;
  /** Why it's related, in plain language. */
  via: string;
}

/**
 * Everything discoverably related to one object: outgoing links, backlinks,
 * project siblings, and shared-tag neighbors — deduplicated, links first.
 */
export function relationshipsFor(id: string, limit = 12): Relationship[] {
  const origin = getObject(id);
  if (!origin) return [];
  const seen = new Set<string>([id]);
  const out: Relationship[] = [];
  const push = (object: SystemObject, via: string) => {
    if (seen.has(object.id) || object.indexState === "excluded") return;
    if (isObjectTrashed(object)) return;
    seen.add(object.id);
    out.push({ object, via });
  };

  for (const o of linksFor(id)) push(o, "linked");
  for (const o of backlinksFor(id)) push(o, "links here");
  if (origin.projectIds.length > 0) {
    for (const o of allObjects()) {
      if (o.projectIds.some((p) => origin.projectIds.includes(p))) push(o, "same project");
    }
  }
  for (const hit of relatedByTags(id)) push(hit.object, `shares #${hit.matchedTags[0]}`);
  return out.slice(0, limit);
}

/* ------------------------------- AI retrieval ------------------------------- */

/** A result snippet safe to show or feed to AI context (redaction-aware). */
export function safeSnippet(text: string, limit = 160): string {
  const clean = redactText(text).replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/** A source label safe to show or cite — titles are user text and can carry
    pasted secrets just like bodies, so they redact too. */
export function safeSourceLabel(o: SystemObject): string {
  return `${o.type} “${redactText(o.title) || "Untitled"}” (${o.source})`;
}

export interface ContextSnippet {
  /** Citable local source label, e.g. `task “Ship it” (local)`. */
  source: string;
  text: string;
  objectId: string;
}

/**
 * The AI-safe retrieval DTO (Wave 3): everything a model context may carry
 * about a retrieved object, and nothing else. No raw SystemObject crosses
 * this boundary — titles, snippets, and tags are redacted, and only objects
 * from currently-readable sources are included. User search (searchAll,
 * which returns full objects for UI rendering) and AI retrieval are now
 * separate APIs with separate return shapes.
 */
export interface AIRetrievedItem {
  objectId: string;
  type: SystemObject["type"];
  title: string;
  snippet: string;
  sourceLabel: string;
  tags: string[];
}

/** Retrieval for AI context: query → redacted, source-authorized DTOs. */
export function retrieveForAI(query: string, limit = 6): AIRetrievedItem[] {
  return searchAll(query)
    .objects // AI retrieval additionally requires the object's source to be readable.
    .filter(({ object }) => isSourceReadableForAI(object))
    .slice(0, limit)
    .map(({ object }) => ({
      objectId: object.id,
      type: object.type,
      title: redactText(object.title) || "Untitled",
      // `||` not `??`: an empty-string body should fall back to the title.
      snippet: safeSnippet(object.body || object.title),
      sourceLabel: safeSourceLabel(object),
      tags: object.tags.map((t) => redactText(t)),
    }));
}

/**
 * The retrieval path AI context assembly uses: search, then return redacted,
 * source-labeled snippets the assistant can cite. Built on retrieveForAI so
 * both shapes share one authorization + redaction path.
 */
export function buildContextSnippets(query: string, limit = 6): ContextSnippet[] {
  return retrieveForAI(query, limit).map((item) => ({
    objectId: item.objectId,
    source: item.sourceLabel,
    text: item.snippet,
  }));
}

/**
 * Relationship discovery for AI context (Wave 3): the authorized counterpart
 * of relationshipsFor. Returns redacted DTOs — never raw objects — and only
 * relationships whose object sits on a currently-readable source.
 */
export function relationshipsForAI(
  id: string,
  limit = 12,
): { item: AIRetrievedItem; via: string }[] {
  return relationshipsFor(id, limit)
    .filter(({ object }) => isSourceReadableForAI(object))
    .map(({ object, via }) => ({
      via,
      item: {
        objectId: object.id,
        type: object.type,
        title: redactText(object.title) || "Untitled",
        snippet: safeSnippet(object.body || object.title),
        sourceLabel: safeSourceLabel(object),
        tags: object.tags.map((t) => redactText(t)),
      },
    }));
}
