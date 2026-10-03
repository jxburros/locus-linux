/*
 * System Cores — the architecture, inspectable from inside the OS.
 * Renders the Core registry (Core API Focus List): every Core's focus, owned
 * data, events, dependents, AI usage path, boundary, and honest status —
 * plus live counts proving which Cores are really running, and the AI
 * routing rule table (the AI uses Cores, never bypasses them).
 */

import { useState, useSyncExternalStore } from "react";
import { CORES, type CoreStatus } from "@/core/cores/registry";
import { AI_CORE_ROUTES } from "@/core/cores/ai";
import { getTimeEntries, subscribeTime } from "@/core/cores/time";
import { listWatches, subscribeWatches } from "@/core/cores/monitor";
import { listSecrets, subscribeSecrets } from "@/core/cores/secrets";
import { listContacts, subscribeContacts } from "@/core/cores/people";
import { listWebApps, subscribeWebApps } from "@/core/cores/web";
import {
  listArtifacts,
  subscribeArtifacts,
  getArtifact,
  validateArtifact,
  runInSandbox,
  canInstall,
  installArtifact,
  uninstallArtifact,
  rollbackArtifact,
  removeArtifact,
  listRuns,
  type DevArtifact,
  type SandboxRun,
} from "@/core/cores/dev";
import { allCards } from "@/core/cores/cardspoke";
import { useObjects } from "@/core/hooks";
import { Section } from "@/components/ui";
import "./cores.css";

/** Dev Core artifact inspector: validate, sandbox-run, install/uninstall,
    rollback, and remove — the pipeline the AI must go through, made visible
    and operable by a human from inside the OS. */
function DevArtifactInspector() {
  const artifacts = useSyncExternalStore(subscribeArtifacts, listArtifacts);
  const [selectedId, setSelectedId] = useState("");
  const [lastRun, setLastRun] = useState<SandboxRun | null>(null);
  const [running, setRunning] = useState(false);

  const selected: DevArtifact | undefined =
    getArtifact(selectedId) ?? artifacts[0];
  const runs = selected ? listRuns(selected.id) : [];
  const gate = selected ? canInstall(selected.id) : { ok: false };

  async function runSandbox() {
    if (!selected) return;
    setRunning(true);
    const run = await runInSandbox(selected.id);
    setLastRun(run);
    setRunning(false);
  }

  if (artifacts.length === 0) {
    return <p className="faint">No generated artifacts yet.</p>;
  }

  return (
    <div className="coresapp__devinspector">
      <div className="coresapp__devlist">
        {artifacts.map((a) => (
          <button
            key={a.id}
            className={`btn btn--sm ${(selected?.id ?? artifacts[0].id) === a.id ? "btn--primary" : "btn--ghost"}`}
            onClick={() => {
              setSelectedId(a.id);
              setLastRun(null);
            }}
          >
            {a.manifest.name} <span className="mono faint">v{a.version} · {a.status}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="coresapp__devdetail">
          <p className="faint">{selected.manifest.description}</p>
          <p className="mono faint">
            {selected.manifest.kind} · by {selected.provenance.createdBy}
            {selected.provenance.model ? ` (${selected.provenance.model})` : ""}
          </p>

          <div className="coresapp__devactions">
            <button className="btn btn--ghost btn--sm" onClick={() => validateArtifact(selected.id)}>
              Validate
            </button>
            <button className="btn btn--ghost btn--sm" onClick={runSandbox} disabled={running}>
              {running ? "Running…" : "Run in sandbox"}
            </button>
            {selected.status === "installed" ? (
              <button className="btn btn--ghost btn--sm" onClick={() => uninstallArtifact(selected.id)}>
                Uninstall
              </button>
            ) : (
              <button
                className="btn btn--ghost btn--sm"
                disabled={!gate.ok}
                title={gate.ok ? "Install" : gate.reason}
                onClick={() => installArtifact(selected.id)}
              >
                Install
              </button>
            )}
            <button
              className="btn btn--ghost btn--sm cards__del"
              onClick={() => {
                if (window.confirm(`Remove artifact “${selected.manifest.name}”? This cannot be undone.`)) {
                  removeArtifact(selected.id);
                  setSelectedId("");
                }
              }}
            >
              Remove
            </button>
          </div>

          {!gate.ok && selected.status !== "installed" && (
            <p className="faint mono">Install refused: {gate.reason}</p>
          )}

          {selected.lastValidation && (
            <ul className="coresapp__facts">
              {selected.lastValidation.checks.map((c) => (
                <li key={c.name}>
                  {c.passed ? "✓" : "✗"} {c.name}
                  {c.detail ? ` — ${c.detail}` : ""}
                </li>
              ))}
            </ul>
          )}

          {(lastRun ?? runs[0]) && (
            <div>
              <span className="eyebrow">Last sandbox run</span>
              <p className="mono faint">
                {(lastRun ?? runs[0])!.ok ? "ok" : "failed"} · {(lastRun ?? runs[0])!.durationMs}ms
              </p>
              <ul className="coresapp__facts">
                {(lastRun ?? runs[0])!.logs.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}

          {selected.versions.length > 0 && (
            <div>
              <span className="eyebrow">Rollback</span>
              <div className="coresapp__devactions">
                {selected.versions.map((v) => (
                  <button
                    key={v.version}
                    className="btn btn--ghost btn--sm"
                    onClick={() => rollbackArtifact(selected.id, v.version)}
                    title={v.note}
                  >
                    v{v.version}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<CoreStatus, string> = {
  functional: "Functional",
  minimal: "Minimal",
  interface: "Interface",
};

export default function Cores() {
  useSyncExternalStore(subscribeTime, getTimeEntries);
  useSyncExternalStore(subscribeWatches, listWatches);
  useSyncExternalStore(subscribeSecrets, listSecrets);
  useSyncExternalStore(subscribeContacts, listContacts);
  useSyncExternalStore(subscribeWebApps, listWebApps);
  useSyncExternalStore(subscribeArtifacts, listArtifacts);
  useObjects();

  const live: Partial<Record<string, string>> = {
    time: `${getTimeEntries().length} entr${getTimeEntries().length === 1 ? "y" : "ies"}`,
    cardspoke: `${allCards().length} objects`,
    monitor: `${listWatches().length} watch${listWatches().length === 1 ? "" : "es"}`,
    secrets: `${listSecrets().length} secret${listSecrets().length === 1 ? "" : "s"}`,
    people: `${listContacts().length} contact${listContacts().length === 1 ? "" : "s"}`,
    web: `${listWebApps().length} web app${listWebApps().length === 1 ? "" : "s"}`,
    dev: `${listArtifacts().length} artifact${listArtifacts().length === 1 ? "" : "s"}`,
  };

  return (
    <div className="coresapp">
      <p className="coresapp__intro">
        The OS is three layers: the <strong>System Layer</strong> (the browser runtime and{" "}
        <code className="mono">core/storage</code>), the <strong>Core Services Layer</strong> below, and the{" "}
        <strong>App Layer</strong>. Apps are the user-facing surfaces; Cores are the shared systems underneath.
        Apps use Cores instead of rebuilding private systems, and the AI must use Cores rather than bypassing
        them.
      </p>

      <Section title={`Core Services (${CORES.length})`}>
        <ul className="coresapp__list">
          {CORES.map((core) => (
            <li key={core.id} className="coresapp__core">
              <div className="coresapp__head">
                <span className="mono coresapp__icon" aria-hidden>{core.icon}</span>
                <h3 className="coresapp__name">{core.name}</h3>
                <span className={`coresapp__status coresapp__status--${core.status} mono`}>
                  {STATUS_LABELS[core.status]}
                </span>
                {live[core.id] && <span className="mono faint coresapp__live">{live[core.id]}</span>}
              </div>
              <p className="coresapp__purpose">{core.purpose}</p>
              <p className="coresapp__aiuse">
                <span className="eyebrow">AI path</span> {core.aiUse}
              </p>
              <p className="coresapp__boundary faint">
                <span className="eyebrow">Boundary</span> {core.boundary}
              </p>
              <div className="coresapp__cols">
                <div>
                  <span className="eyebrow">Owns</span>
                  <ul className="coresapp__facts">
                    {core.owns.map((o) => <li key={o}>{o}</li>)}
                  </ul>
                </div>
                <div>
                  <span className="eyebrow">Events</span>
                  <ul className="coresapp__facts mono coresapp__events">
                    {core.events.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                  <span className="eyebrow">Used by</span>
                  <p className="coresapp__usedby faint">{core.usedBy.join(" · ")}</p>
                </div>
                <div>
                  <span className="eyebrow">Next</span>
                  <ul className="coresapp__facts coresapp__future">
                    {core.future.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Dev Core artifacts">
        <DevArtifactInspector />
      </Section>

      <Section title="Rule: the AI uses Cores">
        <table className="coresapp__routes">
          <thead>
            <tr>
              <th>AI intent</th>
              <th>Routes through</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            {AI_CORE_ROUTES.map((r) => (
              <tr key={r.intent}>
                <td>{r.intent}</td>
                <td className="mono">{r.core} Core</td>
                <td className="faint">{r.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
