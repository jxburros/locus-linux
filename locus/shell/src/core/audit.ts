/*
 * Local audit log.
 * ---------------------------------------------------------------------------
 * A bounded, local record of system events. Any part of the OS can record() an
 * event; the Audit Log app renders them. This is the spine of Locus's
 * transparency promise, so it defends its integrity within its retention
 * window: events that scroll past the live window (MAX_EVENTS) spill into a
 * local archive (MAX_ARCHIVE) rather than vanishing immediately, and
 * "clearing" the log archives it instead of erasing in one call.
 *
 * Retention is bounded, not infinite: once the archive is full the oldest rows
 * are dropped. This is a storage policy, not append-only permanence — a real
 * long-term audit needs an unbounded backing store (IndexedDB/daemon), tracked
 * as a stabilization item.
 *
 * Every recorded event is also republished on the typed event bus
 * (core/events), so Cores and apps can react live without polling the log.
 */

import { storage, StoreKeys } from "./storage";
import { emit } from "./events";
import type { AuditEvent, AuditEventType, AuditSeverity } from "@/types";
import type { AppId } from "@/types";

const MAX_EVENTS = 500;
const MAX_ARCHIVE = 2000;
let eventCache: AuditEvent[] | null = null;

function severityFor(type: AuditEventType): AuditSeverity {
  switch (type) {
    case "ai.approved":
    case "ai.denied":
    case "ai.executed":
    case "ai.refused":
    case "ai.undone":
    case "permission.changed":
    case "trusted_action.changed":
    case "trusted_action.run":
    case "credential.request_granted":
    case "credential.request_denied":
    case "secret.used":
    case "secret.use_denied":
    case "secret.revealed":
    case "secret.access_changed":
    case "vault.unlocked":
    case "file.access.granted":
    case "data.exported":
      return "action";
    case "ai.context_read":
    case "ai.proposed":
    case "ai.routed":
    case "ai.dispatched":
    case "source.indexed":
    case "setting.changed":
    case "monitor.triggered":
    case "manifest.evaluated":
    case "editor.transaction.proposed":
    case "secret.added":
    case "secret.removed":
    case "file.access.requested":
    case "web.pageContext.requested":
    case "web.pageContext.captured":
    case "dev.validated":
    case "dev.installed":
    case "dev.rolledback":
      return "notice";
    default:
      return "info";
  }
}

let seq = 0;
function makeId(): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${Date.now().toString(36)}-${seq.toString(36)}-${rand}`;
}

/*
 * Redaction choke point. Secrets Core registers its redactText here at boot
 * (injected, because Secrets records audit events itself — a direct import
 * would be a cycle). Until registration, text passes through unchanged.
 */
type Redactor = (text: string) => string;
let redactor: Redactor = (text) => text;

/** Called once by Secrets Core so every audit row passes through redaction. */
export function setAuditRedactor(fn: Redactor): void {
  redactor = fn;
}

export function getEvents(): AuditEvent[] {
  if (eventCache === null) {
    eventCache = storage.get<AuditEvent[]>(StoreKeys.auditLog, []);
  }
  return eventCache;
}

/** Events that scrolled out of the live window — older history, newest first. */
export function getArchivedEvents(): AuditEvent[] {
  return storage.get<AuditEvent[]>(StoreKeys.auditArchive, []);
}

function spillToArchive(overflow: AuditEvent[]): void {
  if (overflow.length === 0) return;
  const archive = [...overflow, ...getArchivedEvents()].slice(0, MAX_ARCHIVE);
  storage.set(StoreKeys.auditArchive, archive);
}

export interface RecordInput {
  type: AuditEventType;
  summary: string;
  detail?: string;
  app?: AppId;
  /**
   * Skip the bus republish. For callers that emit their own richer payload
   * for the same event type (e.g. objects.ts emits the SystemObject itself) —
   * without this, every listener fires twice with two payload shapes.
   */
  skipEmit?: boolean;
}

export function record(input: RecordInput): AuditEvent {
  const event: AuditEvent = {
    id: makeId(),
    timestamp: Date.now(),
    type: input.type,
    summary: redactor(input.summary),
    detail: input.detail === undefined ? undefined : redactor(input.detail),
    app: input.app,
    severity: severityFor(input.type),
  };
  const all = [event, ...getEvents()];
  const next = all.slice(0, MAX_EVENTS);
  spillToArchive(all.slice(MAX_EVENTS));
  eventCache = next;
  storage.set(StoreKeys.auditLog, next);
  if (!input.skipEmit) emit(event.type, event);
  return event;
}

/**
 * "Clear" the visible log by archiving it. The audit spine is append-only:
 * nothing is erased, the live window just starts fresh — and the archival
 * itself is on the record.
 */
export function archiveEvents(): void {
  const current = getEvents();
  spillToArchive(current);
  eventCache = [];
  storage.set<AuditEvent[]>(StoreKeys.auditLog, []);
  record({
    type: "system.event",
    summary: `Audit log archived (${current.length} event${current.length === 1 ? "" : "s"} kept in the archive)`,
  });
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.auditLog, () => {
    eventCache = storage.get<AuditEvent[]>(StoreKeys.auditLog, []);
    fn();
  });
}

/** First-boot marker only — the log never fabricates history it didn't see. */
export function seedIfEmpty(): void {
  if (getEvents().length > 0) return;
  record({
    type: "system.event",
    summary: "Locus installed on this device — the audit record starts here",
  });
}
