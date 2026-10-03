import type { AppId } from "./app";

/**
 * Event vocabulary for the local audit log and the system event bus.
 * Namespaced verb-first strings so the list stays greppable and new categories
 * slot in cleanly. Every type here can be persisted to the audit log via
 * record() and/or published live on the event bus via core/events.
 */
export type AuditEventType =
  | "app.opened"
  | "setting.changed"
  | "permission.changed"
  | "ai.context_read"
  | "ai.proposed"
  | "ai.approved"
  | "ai.denied"
  | "ai.executed"
  | "ai.refused"
  | "ai.routed"
  | "ai.dispatched"
  | "ai.undone"
  | "trusted_action.changed"
  | "trusted_action.run"
  | "source.indexed"
  | "credential.request_granted"
  | "credential.request_denied"
  | "object.created"
  | "object.updated"
  | "object.converted"
  | "object.deleted"
  | "object.trashed"
  | "object.restored"
  | "data.exported"
  | "system.event"
  // Time Core
  | "time.entry.created"
  | "time.entry.fired"
  | "time.entry.missed"
  | "time.entry.rescheduled"
  | "time.entry.cancelled"
  // Files Core
  | "file.added"
  | "file.imported"
  | "file.renamed"
  | "file.trashed"
  | "file.restored"
  | "file.access.requested"
  | "file.access.granted"
  // Search / Index Core
  | "search.performed"
  | "index.updated"
  // People Core
  | "contact.created"
  | "contact.updated"
  | "contact.removed"
  | "contact.interaction.logged"
  // Monitor Core
  | "monitor.checked"
  | "monitor.triggered"
  | "monitor.recovered"
  // Web Core
  | "webapp.added"
  | "webapp.removed"
  | "webapp.opened"
  | "web.pageContext.requested"
  | "web.pageContext.captured"
  // Secrets Core
  | "secret.added"
  | "secret.removed"
  | "secret.used"
  | "secret.use_denied"
  | "secret.revealed"
  | "secret.access_changed"
  | "vault.locked"
  | "vault.unlocked"
  // Security Core
  | "manifest.evaluated"
  // Notification Core
  | "notification.delivered"
  | "notification.snoozed"
  // Editor Core
  | "editor.transaction.proposed"
  | "editor.exported"
  // Dev Core
  | "dev.artifact.created"
  | "dev.artifact.updated"
  | "dev.validated"
  | "dev.sandbox.run"
  | "dev.installed"
  | "dev.uninstalled"
  | "dev.rolledback"
  | "dev.removed"
  | "dev.widget.denied";

export type AuditSeverity = "info" | "notice" | "action";

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  /** Human-readable one-liner. Written for the person reading the log. */
  summary: string;
  /** Optional structured context. */
  detail?: string;
  app?: AppId;
  severity: AuditSeverity;
}
