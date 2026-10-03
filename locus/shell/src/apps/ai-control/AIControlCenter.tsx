/*
 * AI Control Center - the heart of Locus.
 * ---------------------------------------------------------------------------
 * Apps expose readable context and possible actions to the AI layer, but the
 * user controls writes, external sharing, trusted automations, and forbidden
 * boundaries. Choosing a provider here only changes what the assistant is
 * ALLOWED to reach — the Model runtime section below is what actually wires
 * a real endpoint in, disabled by default (core/modelRuntime.ts).
 */

import { useState, useSyncExternalStore } from "react";
import { APPS, getApp } from "@/core/appRegistry";
import {
  effectiveCapabilities,
  setCapabilityTier,
  resetAppOverrides,
  hasOverrides,
  subscribe as subscribePerms,
} from "@/core/permissions";
import { useStoredValue } from "@/core/hooks";
import { StoreKeys } from "@/core/storage";
import { getEvents } from "@/core/audit";
import {
  getTrustedActions,
  setTrustedEnabled,
  removeTrustedAction,
  subscribe as subscribeBroker,
} from "@/core/broker";
import {
  getConnections,
  setCapabilityGranted,
  subscribe as subscribeCreds,
} from "@/core/credentials";
import {
  listRoutingRules,
  subscribeRouting,
  addRoutingRule,
  setRoutingRuleEnabled,
  removeRoutingRule,
  suggestRoute,
  isValidPattern,
  type ModelRoute,
} from "@/core/cores/ai";
import {
  canDispatch,
  canTestConnection,
  endpointClass,
  getModelRuntimeConfig,
  hasSessionKey,
  requestRuntimeKey,
  setModelRuntimeConfig,
  subscribeModelRuntime,
  testConnection,
  type ModelRuntimeConfig,
} from "@/core/modelRuntime";
import { listRefsForAI } from "@/core/cores/secrets";
import { CAPABILITY_META, CAPABILITY_TIERS } from "@/types";
import type { AppId, CapabilityTier } from "@/types";
import { Section } from "@/components/ui";
import "./ai-control.css";

const PROVIDERS = [
  { id: "none", label: "None", detail: "No AI is connected. Apps run fully on their own.", kind: "off" },
  {
    id: "local",
    label: "On-device model",
    detail: "Runs on a local endpoint you configure below (e.g. Ollama, LM Studio).",
    kind: "local",
  },
  {
    id: "cloud",
    label: "Cloud model",
    detail: "A hosted endpoint you explicitly configure and acknowledge below.",
    kind: "cloud",
  },
] as const;

function useOverrideTick(): number {
  return useSyncExternalStore(
    (cb) => subscribePerms(cb),
    () => getEvents().length,
  );
}

export default function AIControlCenter() {
  const [provider, setProvider] = useStoredValue<string>(StoreKeys.aiProvider, "none");
  const [selectedAppId, setSelectedAppId] = useState<AppId>("writer");
  useOverrideTick();

  const app = getApp(selectedAppId)!;
  const manifest = app.permissions;
  const caps = effectiveCapabilities(app.id, manifest.ai);

  const flat = (CAPABILITY_TIERS as CapabilityTier[])
    .flatMap((tier) => caps[tier].map((label) => ({ label, tier })))
    .sort((a, b) => CAPABILITY_META[a.tier].rank - CAPABILITY_META[b.tier].rank);

  return (
    <div className="aicc">
      <Section title="Chosen AI system">
        <div className="aicc__providers">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`aicc__provider ${provider === p.id ? "is-active" : ""}`}
              onClick={() => setProvider(p.id)}
              aria-pressed={provider === p.id}
            >
              <span className="aicc__provider-head">
                <span className={`aicc__dot aicc__dot--${p.kind}`} aria-hidden />
                <span className="aicc__provider-label">{p.label}</span>
              </span>
              <span className="muted aicc__provider-detail">{p.detail}</span>
            </button>
          ))}
        </div>
      </Section>

      <ModelRuntimeSection />

      <Section title="Read broadly, act carefully">
        <div className="aicc__policy-grid">
          <article className="aicc__policy-card">
            <h3>Connected context</h3>
            <p className="muted">
              Reading and indexing are normal inside connected sources, so the AI can answer from visible app state and local OS content.
            </p>
          </article>
          <article className="aicc__policy-card">
            <h3>Approval boundary</h3>
            <p className="muted">
              Writes, exports, provider changes, credential use, deletes, and external communications require approval or a trusted action.
            </p>
          </article>
          <article className="aicc__policy-card">
            <h3>Audit spine</h3>
            <p className="muted">
              Context reads, indexing, proposals, approvals, denials, and trusted actions are designed to be logged locally.
            </p>
          </article>
        </div>
      </Section>

      <Section title="The five AI tiers">
        <ol className="aicc__ladder">
          {(CAPABILITY_TIERS as CapabilityTier[]).map((tier) => {
            const meta = CAPABILITY_META[tier];
            return (
              <li key={tier} className={`aicc__rung aicc__rung--${tier}`}>
                <span className="aicc__rung-num mono">{meta.rank}</span>
                <span className="aicc__rung-label">{meta.label}</span>
                <span className="muted aicc__rung-desc">{meta.description}</span>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section
        title="App manifests"
        action={
          hasOverrides(app.id) ? (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => resetAppOverrides(app.id, app.name)}
            >
              Reset {app.name}
            </button>
          ) : null
        }
      >
        <div className="aicc__appbar" role="tablist" aria-label="Choose an app">
          {APPS.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={a.id === selectedAppId}
              className={`aicc__apptab ${a.id === selectedAppId ? "is-active" : ""}`}
              onClick={() => setSelectedAppId(a.id)}
            >
              <span className="mono" aria-hidden>{a.icon}</span> {a.name}
            </button>
          ))}
        </div>

        <div className="aicc__manifest-grid">
          <ManifestList title="Local data" items={manifest.localData} />
          <ManifestList title="Device" items={manifest.device} empty="No direct device surface." />
          <ManifestList title="Network" items={manifest.network} empty="Local-only in this build." />
        </div>

        <table className="aicc__table">
          <thead>
            <tr>
              <th>AI capability</th>
              <th>Permission</th>
            </tr>
          </thead>
          <tbody>
            {flat.map(({ label, tier }) => (
              <tr key={label}>
                <td className="aicc__cap">{label}</td>
                <td className="aicc__tier-cell">
                  <span className={`aicc__pill aicc__pill--${tier} mono`}>
                    {CAPABILITY_META[tier].label}
                  </span>
                  <select
                    className="aicc__select"
                    value={tier}
                    aria-label={`Permission for: ${label}`}
                    onChange={(e) =>
                      setCapabilityTier(
                        app.id,
                        app.name,
                        label,
                        e.target.value as CapabilityTier,
                      )
                    }
                  >
                    {(CAPABILITY_TIERS as CapabilityTier[]).map((t) => (
                      <option key={t} value={t}>
                        {CAPABILITY_META[t].label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint aicc__hint">
          Changes are saved locally and written to the audit log. Apps declare capabilities; only the user can change the effective tier.
        </p>
      </Section>

      <TrustedActions />

      <RoutingRules />

      <CredentialBroker />

      <Section title="AI activity">
        <AIActivity />
      </Section>
    </div>
  );
}

/** The real (opt-in) model runtime: an OpenAI-compatible endpoint the user
    configures, disabled by default, gated by canDispatch() at every step —
    the status line below always reflects what a request would actually do
    right now, never an aspirational "connected". */
function ModelRuntimeSection() {
  const config = useSyncExternalStore(subscribeModelRuntime, getModelRuntimeConfig);
  // Re-render when a broker proposal settles — the "armed for this session"
  // state depends on an approved secrets.use proposal, not local state.
  useSyncExternalStore(subscribeBroker, () => hasSessionKey());
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const refs = listRefsForAI().filter((r) => r.aiAccess === "brokered");
  const cls = endpointClass(config.endpointUrl);
  const gate = canDispatch();
  const testAllowed = canTestConnection().ok && !testing;
  const armed = hasSessionKey();

  function patch(next: Partial<ModelRuntimeConfig>) {
    setModelRuntimeConfig(next);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection();
    setTestResult(result.detail);
    setTesting(false);
  }

  return (
    <Section title="Model runtime">
      <p className="muted aicc__hint aicc__hint--lead">
        Connect a real OpenAI-compatible endpoint (Ollama, LM Studio, or a cloud provider you
        configure). Disabled by default — nothing is dispatched unless enabled here, and a remote
        endpoint additionally needs the explicit acknowledgment below it.
      </p>

      <div className="aicc__runtime-grid">
        <label className="aicc__runtime-field">
          <span className="mono">Endpoint URL</span>
          <input
            className="field"
            value={config.endpointUrl}
            onChange={(e) => patch({ endpointUrl: e.target.value })}
            placeholder="http://localhost:11434"
            aria-label="Model runtime endpoint URL"
          />
        </label>
        <label className="aicc__runtime-field">
          <span className="mono">Model</span>
          <input
            className="field"
            value={config.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="llama3"
            aria-label="Model name"
          />
        </label>
        <label className="aicc__switch">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>Enabled</span>
        </label>
      </div>

      <div className="aicc__runtime-key">
        <label className="aicc__runtime-field">
          <span className="mono">API key</span>
          <select
            className="field"
            value={config.apiKeySecretRef ?? ""}
            onChange={(e) => patch({ apiKeySecretRef: e.target.value || undefined })}
            aria-label="API key secret reference"
          >
            <option value="">No key</option>
            {refs.map((r) => (
              <option key={r.ref} value={r.ref}>{r.ref}</option>
            ))}
          </select>
        </label>
        {config.apiKeySecretRef && (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void requestRuntimeKey()}
            disabled={armed}
          >
            {armed ? "Armed for this session" : "Request key approval"}
          </button>
        )}
      </div>

      {cls === "remote" && (
        <div className="aicc__runtime-warning">
          <p className="aicc__runtime-danger mono">
            Requests will send assembled local context to {safeHost(config.endpointUrl)} — data
            leaves this device.
          </p>
          <label className="aicc__switch">
            <input
              type="checkbox"
              checked={config.allowRemote}
              onChange={(e) => patch({ allowRemote: e.target.checked })}
            />
            <span>I understand local context will be sent to this remote endpoint</span>
          </label>
        </div>
      )}

      <p
        className={`mono aicc__runtime-status ${
          gate.ok ? "aicc__runtime-status--ok" : "aicc__runtime-status--refused"
        }`}
      >
        {gate.ok
          ? `Ready — ${cls === "local" ? "local endpoint" : "remote endpoint, acknowledged"}`
          : gate.reason}
      </p>

      <div className="aicc__runtime-test">
        <button className="btn btn--ghost btn--sm" onClick={runTest} disabled={!testAllowed}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        {testResult && <span className="mono faint">{testResult}</span>}
      </div>
    </Section>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url.trim()).host;
  } catch {
    return url || "(no endpoint)";
  }
}

/** AI Core's Model Traffic Manager: keyword rules → local/cloud, tested live.
    The assistant consults these on every request (its “via:” line). */
function RoutingRules() {
  const rules = useSyncExternalStore(subscribeRouting, listRoutingRules);
  const [pattern, setPattern] = useState("");
  const [route, setRoute] = useState<ModelRoute>("local");
  const [modelHint, setModelHint] = useState("");
  const [test, setTest] = useState("");
  const suggestion = test.trim() ? suggestRoute(test) : null;

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPattern(pattern)) return;
    addRoutingRule({ pattern, route, modelHint: modelHint || undefined });
    setPattern("");
    setModelHint("");
  }

  return (
    <Section title="Model routing rules">
      <p className="muted aicc__hint aicc__hint--lead">
        Keyword rules decide where a request would run — the default is local, and nothing leaves
        the device unless a rule you wrote routes it out. The assistant shows the decision on
        every answer.
      </p>
      {rules.length > 0 && (
        <ul className="aicc__routes">
          {rules.map((r) => (
            <li key={r.id} className="aicc__route">
              <label className="aicc__switch">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => setRoutingRuleEnabled(r.id, e.target.checked)}
                />
                <code className="mono">{r.pattern}</code>
              </label>
              <span className="chip mono">→ {r.route}{r.modelHint ? ` (${r.modelHint})` : ""}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => removeRoutingRule(r.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="aicc__routeadd" onSubmit={add}>
        <input
          className="field aicc__grow"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="Keywords, comma-separated (e.g. code, refactor)"
          aria-label="Rule keywords"
        />
        <select className="field" value={route} onChange={(e) => setRoute(e.target.value as ModelRoute)} aria-label="Route">
          <option value="local">local</option>
          <option value="cloud">cloud</option>
        </select>
        <input
          className="field"
          value={modelHint}
          onChange={(e) => setModelHint(e.target.value)}
          placeholder="Model hint (optional)"
          aria-label="Model hint"
        />
        <button className="btn btn--primary btn--sm" type="submit" disabled={!isValidPattern(pattern)}>
          Add rule
        </button>
      </form>
      <div className="aicc__routetest">
        <input
          className="field aicc__grow"
          value={test}
          onChange={(e) => setTest(e.target.value)}
          placeholder="Test a request: where would it route?"
          aria-label="Test routing"
        />
        {suggestion && (
          <span className="mono faint">
            → {suggestion.route}
            {suggestion.modelHint ? ` (${suggestion.modelHint})` : ""} · {suggestion.reason}
          </span>
        )}
      </div>
    </Section>
  );
}

function TrustedActions() {
  const actions = useSyncExternalStore(subscribeBroker, getTrustedActions);
  return (
    <Section title="Trusted actions">
      <p className="muted aicc__hint aicc__hint--lead">
        Named, opt-in automations that may run without asking. Each records its scope, trigger,
        the data it touches, and how to undo it. Nothing is trusted until you enable it.
      </p>
      {actions.length ? (
        <ul className="aicc__trusted">
          {actions.map((a) => (
            <li key={a.id} className="aicc__trusted-item panel">
              <div className="aicc__trusted-head">
                <label className="aicc__switch">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={(e) => setTrustedEnabled(a.id, e.target.checked)}
                  />
                  <span className="aicc__trusted-name">{a.name}</span>
                </label>
                <span className="chip mono">{getApp(a.app)?.name ?? a.app}</span>
              </div>
              <dl className="aicc__trusted-meta">
                <div><dt>Scope</dt><dd>{a.scope}</dd></div>
                <div><dt>Trigger</dt><dd>{a.trigger}</dd></div>
                <div><dt>Data touched</dt><dd>{a.dataTouched}</dd></div>
                <div><dt>Undo</dt><dd>{a.undoNotes}</dd></div>
              </dl>
              <button
                className="btn btn--ghost btn--sm aicc__trusted-remove"
                onClick={() => removeTrustedAction(a.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="faint">
          No trusted actions defined yet. Until one exists, every AI change waits for approval.
        </p>
      )}
    </Section>
  );
}

function CredentialBroker() {
  const connections = useSyncExternalStore(subscribeCreds, getConnections);
  return (
    <Section title="Credential Broker">
      <p className="muted aicc__hint aicc__hint--lead">
        External accounts expose <em>capabilities</em>, never raw secrets. Grant a scoped
        operation and the AI may use it; the token itself stays with the broker.
      </p>
      <div className="aicc__creds">
        {connections.map((c) => (
          <article key={c.id} className="aicc__cred panel">
            <div className="aicc__cred-head">
              <span className="aicc__cred-name">{c.name}</span>
              <span className="chip mono">{c.hasSecret ? "secret held" : "no secret"}</span>
            </div>
            <ul className="aicc__cred-caps">
              {c.capabilities.map((k) => (
                <li key={k.id} className="aicc__cred-cap">
                  <label className="aicc__switch">
                    <input
                      type="checkbox"
                      checked={k.granted}
                      onChange={(e) => setCapabilityGranted(c.id, k.id, e.target.checked)}
                    />
                    <span>{k.label}</span>
                  </label>
                  <span className={`aicc__risk aicc__risk--${k.risk} mono`}>{k.risk}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Section>
  );
}

function ManifestList({
  title,
  items,
  empty = "None declared.",
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  return (
    <article className="aicc__manifest-card">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="faint">{empty}</p>
      )}
    </article>
  );
}

function AIActivity() {
  const aiEvents = getEvents()
    .filter((e) => e.type.startsWith("ai."))
    .slice(0, 5);
  if (aiEvents.length === 0) {
    return <p className="faint">No AI actions yet. Proposals and approvals will appear here.</p>;
  }
  return (
    <ul className="aicc__activity">
      {aiEvents.map((e) => (
        <li key={e.id} className="aicc__activity-item">
          <span className={`aicc__evt aicc__evt--${e.type.split(".")[1]} mono`}>
            {e.type.split(".")[1]}
          </span>
          <span>{e.summary}</span>
        </li>
      ))}
    </ul>
  );
}
