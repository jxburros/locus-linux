/*
 * Settings — appearance is fully functional; other panels are honest stubs.
 * Everything persists through core/storage.
 */

import { useState, useSyncExternalStore } from "react";
import { useAppearance } from "@/core/AppearanceProvider";
import { ACCENTS, DEFAULT_SYSTEM_NAME } from "@/core/theme";
import type { ThemeMode, Density, AccentName } from "@/core/theme";
import { storage, StoreKeys } from "@/core/storage";
import { useStoredValue } from "@/core/hooks";
import { useShell } from "@/core/shell";
import { record } from "@/core/audit";
import { getLowPower, setLowPower, resetDashboard } from "@/core/desktop";
import {
  getNotificationPolicy,
  setNotificationPolicy,
  setSourceMuted,
  subscribeNotificationPolicy,
  groupBySource,
} from "@/core/cores/notification";
import { Section, FutureNote } from "@/components/ui";
import "./settings.css";

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const DENSITIES: { id: Density; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "spacious", label: "Spacious" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function Settings() {
  const { appearance, update } = useAppearance();
  const { openApp } = useShell();
  const [confirmReset, setConfirmReset] = useState(false);
  const [reducedMotion, setReducedMotion] = useStoredValue<boolean>(StoreKeys.reducedMotion, false);
  const [assistantName, setAssistantName] = useStoredValue<string>(StoreKeys.assistantName, "Milo");
  const [lowPower, setLowPowerState] = useState(() => getLowPower());
  const bytes = storage.estimateBytes();

  function exportAll() {
    const payload = storage.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `locus-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    record({
      type: "data.exported",
      app: "settings",
      summary: `All local data exported (${Object.keys(payload.data).length} stores)`,
    });
  }

  function resetAll() {
    record({ type: "system.event", app: "settings", summary: "All local data reset by the user" });
    storage.clearAll();
    window.location.reload();
  }

  return (
    <div className="settings">
      {/* Appearance ---------------------------------------------------------- */}
      <Section title="Appearance">
        <div className="settings__row">
          <div className="settings__label">
            <span>Theme</span>
            <span className="faint">Light, dark, or follow the system.</span>
          </div>
          <div className="settings__segmented">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={appearance.theme === t.id ? "is-active" : ""}
                aria-pressed={appearance.theme === t.id}
                onClick={() => update({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span>Accent</span>
            <span className="faint">One color, used sparingly.</span>
          </div>
          <div className="settings__accents">
            {ACCENTS.map((a) => (
              <button
                key={a.name}
                className={`settings__accent ${appearance.accent === a.name ? "is-active" : ""}`}
                style={{ ["--swatch" as string]: a.swatch }}
                aria-pressed={appearance.accent === a.name}
                aria-label={a.label}
                title={a.label}
                onClick={() => update({ accent: a.name as AccentName })}
              />
            ))}
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span>Density</span>
            <span className="faint">Spacing across the whole system.</span>
          </div>
          <div className="settings__segmented">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                className={appearance.density === d.id ? "is-active" : ""}
                aria-pressed={appearance.density === d.id}
                onClick={() => update({ density: d.id })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span>System name</span>
            <span className="faint">What this environment calls itself.</span>
          </div>
          <input
            className="field settings__name"
            value={appearance.systemName}
            onChange={(e) => update({ systemName: e.target.value || DEFAULT_SYSTEM_NAME })}
            aria-label="System name"
          />
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span>Reduced motion</span>
            <span className="faint">Minimize animation everywhere.</span>
          </div>
          <div className="settings__segmented">
            <button className={!reducedMotion ? "is-active" : ""} onClick={() => setReducedMotion(false)}>
              Full
            </button>
            <button className={reducedMotion ? "is-active" : ""} onClick={() => setReducedMotion(true)}>
              Reduced
            </button>
          </div>
        </div>
      </Section>

      {/* Desktop --------------------------------------------------------------- */}
      <Section title="Desktop">
        <div className="settings__row">
          <div className="settings__label">
            <span>Low-power mode</span>
            <span className="faint">Slows tile refresh and stops non-essential animation.</span>
          </div>
          <div className="settings__segmented">
            <button
              className={!lowPower ? "is-active" : ""}
              onClick={() => {
                setLowPower(false);
                setLowPowerState(false);
              }}
            >
              Normal
            </button>
            <button
              className={lowPower ? "is-active" : ""}
              onClick={() => {
                setLowPower(true);
                setLowPowerState(true);
              }}
            >
              Low power
            </button>
          </div>
        </div>
        <div className="settings__row">
          <div className="settings__label">
            <span>Reset Dashboard</span>
            <span className="faint">Restore the default first-run tile arrangement.</span>
          </div>
          <button className="btn" onClick={resetDashboard}>Reset Dashboard</button>
        </div>
      </Section>

      {/* Notifications -------------------------------------------------------- */}
      <NotificationSettings />

      {/* AI provider --------------------------------------------------------- */}
      <Section title="AI">
        <div className="settings__row">
          <div className="settings__label">
            <span>Assistant name</span>
            <span className="faint">Yours to choose. The provider behind it is separate.</span>
          </div>
          <input
            className="field settings__name"
            value={assistantName}
            onChange={(e) => setAssistantName(e.target.value)}
            aria-label="Assistant name"
          />
        </div>
        <div className="settings__row">
          <div className="settings__label">
            <span>AI provider &amp; permissions</span>
            <span className="faint">Choose a model and set what it may do.</span>
          </div>
          <button className="btn" onClick={() => openApp("ai-control")}>
            Open AI Control Center
          </button>
        </div>
      </Section>

      {/* Storage ------------------------------------------------------------- */}
      <Section title="Storage">
        <div className="settings__row">
          <div className="settings__label">
            <span>Local data</span>
            <span className="faint">Everything stays on this device.</span>
          </div>
          <span className="mono">{formatBytes(bytes)} used</span>
        </div>
        <div className="settings__row">
          <div className="settings__label">
            <span>Export all data</span>
            <span className="faint">
              Download everything — objects, settings, audit history — as one JSON file.
              Vault values stay encrypted in the export.
            </span>
          </div>
          <button className="btn" onClick={exportAll}>Export…</button>
        </div>
        <div className="settings__row">
          <div className="settings__label">
            <span>Reset all data</span>
            <span className="faint">Wipes appearance, workspaces, all objects, and the audit log.</span>
          </div>
          {confirmReset ? (
            <div className="settings__confirm">
              <button className="btn btn--sm" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn btn--sm settings__danger" onClick={resetAll}>Erase everything</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirmReset(true)}>Reset…</button>
          )}
        </div>
      </Section>

      {/* About --------------------------------------------------------------- */}
      <AboutSection appearance={appearance} />
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

/** Quiet hours + per-source mute — the Notification Core policy, finally
    reachable. Critical alerts always break through both. */
function NotificationSettings() {
  useSyncExternalStore(subscribeNotificationPolicy, () =>
    JSON.stringify(getNotificationPolicy()),
  );
  const policy = getNotificationPolicy();
  const sources = groupBySource().map((g) => g.source);

  return (
    <Section title="Notifications">
      <div className="settings__row">
        <div className="settings__label">
          <span>Quiet hours</span>
          <span className="faint">
            Non-critical alerts are held (not dropped) and surface when the window ends.
          </span>
        </div>
        <div className="settings__segmented">
          <button
            className={!policy.quietEnabled ? "is-active" : ""}
            onClick={() => setNotificationPolicy({ quietEnabled: false })}
          >
            Off
          </button>
          <button
            className={policy.quietEnabled ? "is-active" : ""}
            onClick={() => setNotificationPolicy({ quietEnabled: true })}
          >
            On
          </button>
        </div>
      </div>
      {policy.quietEnabled && (
        <div className="settings__row">
          <div className="settings__label">
            <span>Quiet window</span>
            <span className="faint">Critical alerts always break through.</span>
          </div>
          <div className="settings__quiet">
            <select
              className="field"
              value={policy.quietStartHour}
              onChange={(e) => setNotificationPolicy({ quietStartHour: Number(e.target.value) })}
              aria-label="Quiet hours start"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
            <span className="faint">to</span>
            <select
              className="field"
              value={policy.quietEndHour}
              onChange={(e) => setNotificationPolicy({ quietEndHour: Number(e.target.value) })}
              aria-label="Quiet hours end"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <div className="settings__row">
          <div className="settings__label">
            <span>Muted sources</span>
            <span className="faint">Muted senders land in history already-read.</span>
          </div>
          <div className="settings__mutes">
            {sources.map((s) => {
              const muted = policy.mutedSources.includes(s);
              return (
                <button
                  key={s}
                  className={`chip settings__mute ${muted ? "is-muted" : ""}`}
                  onClick={() => setSourceMuted(s, !muted)}
                  aria-pressed={muted}
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? "🔇 " : ""}{s}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function AboutSection({ appearance }: { appearance: { systemName: string } }) {
  return (
    <Section title="About">
        <dl className="settings__about">
          <div><dt>System</dt><dd>{appearance.systemName}</dd></div>
          <div><dt>Version</dt><dd className="mono">0.5.0 — spatial workspace</dd></div>
          <div><dt>Model</dt><dd>Local-first, AI-aware personal environment</dd></div>
          <div><dt>Data</dt><dd>Stored locally in your browser</dd></div>
        </dl>
        <FutureNote
          items={[
            "Per-app permission detail lives in the AI Control Center",
            "Import/export of all data as a portable bundle",
            "Sync as an opt-in enhancement, never a requirement",
          ]}
        />
    </Section>
  );
}
