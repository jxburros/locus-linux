/*
 * The typed system event bus (shared foundation F1).
 * ---------------------------------------------------------------------------
 * Cores emit events; anything can subscribe — by exact type, by namespace
 * prefix ("file.*"), or to everything ("*"). This is the live signal layer
 * that makes each Core's declared `events` list true: the audit log is the
 * persistent record (core/audit), the bus is the in-flight one.
 *
 * audit.record() republishes every persisted event here automatically, so a
 * Core that records is also emitting. emit() alone is for high-frequency
 * signals not worth an audit row (object.updated per keystroke,
 * monitor.checked per pass, search.performed per query).
 */

import type { AuditEventType } from "@/types";

export interface SystemEvent {
  type: AuditEventType;
  at: number;
  /** Optional structured payload — the Core-specific record behind the event. */
  payload?: unknown;
}

export type SystemEventListener = (event: SystemEvent) => void;

/** Exact type, a namespace wildcard like "file.*", or "*" for everything. */
export type EventPattern = AuditEventType | `${string}.*` | "*";

const listeners = new Map<string, Set<SystemEventListener>>();

function matchSets(type: AuditEventType): Set<SystemEventListener>[] {
  const out: Set<SystemEventListener>[] = [];
  const exact = listeners.get(type);
  if (exact) out.push(exact);
  // Wildcards at every namespace depth: "web.pageContext.captured" matches
  // both "web.*" and "web.pageContext.*".
  const parts = type.split(".");
  for (let depth = 1; depth < parts.length; depth++) {
    const wild = listeners.get(`${parts.slice(0, depth).join(".")}.*`);
    if (wild) out.push(wild);
  }
  const all = listeners.get("*");
  if (all) out.push(all);
  return out;
}

/** Subscribe to system events. Returns an unsubscribe function. */
export function on(pattern: EventPattern, fn: SystemEventListener): () => void {
  if (!listeners.has(pattern)) listeners.set(pattern, new Set());
  listeners.get(pattern)!.add(fn);
  return () => listeners.get(pattern)?.delete(fn);
}

/** Publish an event to live subscribers. Does not persist — use audit.record
    for anything that belongs on the permanent record (it emits here too). */
export function emit(type: AuditEventType, payload?: unknown): void {
  const event: SystemEvent = { type, at: Date.now(), payload };
  for (const set of matchSets(type)) {
    for (const fn of set) {
      try {
        fn(event);
      } catch (err) {
        console.warn("[locus:events] listener failed for", type, err);
      }
    }
  }
}
