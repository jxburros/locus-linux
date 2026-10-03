/*
 * Shared UI primitives used across app stubs so every app surface feels like
 * part of the same OS. Intentionally small and unstyled-by-props — visual
 * language comes from tokens.css, not from ad-hoc styles in each app.
 */

import type { ReactNode } from "react";
import "./ui.css";

export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ui-section">
      {(title || action) && (
        <div className="ui-section__head">
          {title && <h2 className="eyebrow">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__title">{title}</p>
      {hint && <p className="ui-empty__hint muted">{hint}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

/**
 * A distinct, honest callout that marks what a stub will grow into. Keeps the
 * v1 app from over-promising while signalling direction. This is a signature
 * pattern of the build: the OS tells you plainly what is placeholder.
 */
export function FutureNote({ items }: { items: string[] }) {
  return (
    <div className="ui-future" role="note">
      <span className="ui-future__tag mono">PLANNED</span>
      <ul className="ui-future__list">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar">{children}</div>;
}

export function StatusBadge({
  status,
}: {
  status: "stable" | "beta" | "stub";
}) {
  const label = status === "stub" ? "Stub" : status === "beta" ? "Beta" : "Stable";
  return <span className={`ui-status ui-status--${status} mono`}>{label}</span>;
}
