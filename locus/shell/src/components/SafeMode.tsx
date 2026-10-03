/*
 * Safe mode — the root recovery surface (stabilization Wave 2).
 * ---------------------------------------------------------------------------
 * When boot (Core initialization) or the mounted shell throws, the user must
 * not be left with a blank page and no way at their data. Safe mode renders
 * instead: it shows the failure honestly, offers the full data export
 * (including memory-only values), lets the user reset ONE store at a time —
 * so a single corrupt record does not force "wipe everything" — and retries.
 *
 * Deliberately minimal and dependency-light: it must render even when most of
 * the system is broken. Uses only the shared UI atoms and design tokens.
 */

import { Component, useState, type ReactNode } from "react";
import { storage, StoreKeys } from "@/core/storage";

function downloadExport(): void {
  const payload = storage.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `locus-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function SafeMode({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [resetKeys, setResetKeys] = useState<string[]>([]);
  const stores = Object.entries(StoreKeys);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg-0, #111)",
        color: "var(--text-1, #eee)",
      }}
    >
      <div className="panel stack" style={{ maxWidth: 560, width: "100%", padding: 20, gap: 14 }}>
        <div>
          <div className="eyebrow">Locus OS</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 18 }}>Safe mode</h1>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Something failed while starting or running the shell. Your data is still on this
          device — export it first, then reset the one store that is breaking boot, and retry.
        </p>
        <div className="mono" style={{ fontSize: 12, whiteSpace: "pre-wrap", opacity: 0.85 }}>
          {describeError(error)}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn--primary" onClick={downloadExport}>
            Export all data
          </button>
          <button className="btn" onClick={onRetry}>
            Retry boot
          </button>
        </div>
        <div className="divider" />
        <div>
          <div className="eyebrow">Reset one store</div>
          <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>
            Removes only that store's persisted value (its durable mirror copy too). Click a
            store once to arm it, again to reset it. Export first — a reset is permanent.
          </p>
          <div style={{ maxHeight: 220, overflowY: "auto" }} className="stack">
            {stores.map(([name, key]) => {
              const wasReset = resetKeys.includes(key);
              const armed = armedKey === key;
              return (
                <div key={key} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {key}
                    {wasReset ? " · reset" : ""}
                  </span>
                  <button
                    className={`btn btn--sm${armed ? " btn--primary" : " btn--ghost"}`}
                    disabled={wasReset}
                    aria-label={`Reset ${name}`}
                    onClick={() => {
                      if (!armed) {
                        setArmedKey(key);
                        return;
                      }
                      storage.remove(key);
                      setResetKeys((prev) => [...prev, key]);
                      setArmedKey(null);
                    }}
                  >
                    {wasReset ? "Reset" : armed ? "Confirm reset" : "Reset…"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Root error boundary: a render/runtime crash inside the shell drops the user
 * into Safe mode (with the same export / per-store reset tools) instead of a
 * white screen. Retry clears the boundary and re-renders in place.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown | null }> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("[locus] shell crashed — safe mode engaged", error);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <SafeMode error={this.state.error} onRetry={() => this.setState({ error: null })} />
      );
    }
    return this.props.children;
  }
}
