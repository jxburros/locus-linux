/*
 * Dev — the full authoring surface over Dev Core (Core API Focus List).
 * ---------------------------------------------------------------------------
 * The Cores app's DevArtifactInspector is a system-inspector view (validate,
 * run, install, rollback). This app is the authoring surface: create an
 * artifact, edit its code with a diff-first save flow, and — for an
 * installed widget — place it on the desktop as a sandboxed devwidget tile.
 * Every write still goes through Dev Core's own gates (updateArtifactCode,
 * validateArtifact, canInstall) — this surface adds no shortcuts around them.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  listArtifacts,
  subscribeArtifacts,
  getArtifact,
  createArtifact,
  updateArtifactCode,
  diffArtifact,
  validateArtifact,
  runInSandbox,
  canInstall,
  installArtifact,
  uninstallArtifact,
  rollbackArtifact,
  removeArtifact,
  listRuns,
  type DevArtifact,
  type ArtifactKind,
  type SandboxRun,
} from "@/core/cores/dev";
import { addTile } from "@/core/desktop";
import { formatDateTime } from "@/core/cores/time";
import { Section, FutureNote, EmptyState, Toolbar } from "@/components/ui";
import type { DiffLine } from "@/core/cores/editor";
import "./dev.css";

const KINDS: ArtifactKind[] = ["app", "widget", "anchor", "snippet"];

const STATUS_LABELS: Record<DevArtifact["status"], string> = {
  draft: "Draft",
  validated: "Validated",
  rejected: "Rejected",
  installed: "Installed",
};

/* -------------------------------------- list -------------------------------------- */

function ArtifactList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: DevArtifact[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (artifacts.length === 0) {
    return <EmptyState title="No artifacts yet" hint="Create one below to start the pipeline." />;
  }
  return (
    <ul className="devapp__list">
      {artifacts.map((a) => (
        <li key={a.id}>
          <button
            className={`devapp__row ${a.id === selectedId ? "is-active" : ""}`}
            onClick={() => onSelect(a.id)}
          >
            <span className="devapp__rowname">{a.manifest.name}</span>
            <span className="mono faint devapp__rowmeta">
              {a.manifest.kind} · v{a.version} ·{" "}
              <span className={`devapp__status devapp__status--${a.status}`}>{STATUS_LABELS[a.status]}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------ create form ----------------------------------- */

function CreateForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("widget");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;
    const a = createArtifact({
      name,
      kind,
      description,
      code,
      permissions: [],
      dependencies: [],
      network: false,
      provenance: { createdBy: "user" },
    });
    setName("");
    setDescription("");
    setCode("");
    setOpen(false);
    onCreated(a.id);
  }

  if (!open) {
    return (
      <button className="btn btn--sm btn--primary devapp__newbtn" onClick={() => setOpen(true)}>
        + New artifact
      </button>
    );
  }

  return (
    <form className="devapp__create panel" onSubmit={submit}>
      <div className="devapp__createrow">
        <input
          className="field"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <select className="field devapp__kindselect" value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <input
        className="field"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="field devapp__codearea"
        placeholder="Code (plain JavaScript)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={6}
      />
      <div className="devapp__createactions">
        <button className="btn btn--sm btn--primary" type="submit" disabled={!name.trim() || !description.trim()}>
          Create draft
        </button>
        <button className="btn btn--sm btn--ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------ diff view ------------------------------------ */

function DiffView({ diff }: { diff: DiffLine[] }) {
  const changed = diff.filter((l) => l.kind !== "same");
  if (changed.length === 0) {
    return <p className="faint devapp__diffempty">No change from the current code.</p>;
  }
  return (
    <ul className="devapp__diff mono">
      {diff.map((l, i) =>
        l.kind === "same" ? null : (
          <li key={i} className={`devapp__diffline devapp__diffline--${l.kind}`}>
            {l.kind === "added" ? "+ " : "− "}
            {l.text || " "}
          </li>
        ),
      )}
    </ul>
  );
}

/* ---------------------------------- code editor panel -------------------------------- */

function CodeEditor({ artifact }: { artifact: DevArtifact }) {
  const [draft, setDraft] = useState(artifact.code);
  const [showDiff, setShowDiff] = useState(false);
  const [note, setNote] = useState("");

  // The draft resets whenever the selection changes (a new artifact, or this
  // one just took a new version) — never silently overwritten mid-edit.
  useEffect(() => {
    setDraft(artifact.code);
    setShowDiff(false);
    setNote("");
  }, [artifact.id, artifact.code]);

  const dirty = draft !== artifact.code;
  const diff = showDiff ? diffArtifact(artifact.id, draft) : [];

  function apply() {
    updateArtifactCode(artifact.id, draft, note.trim() || "Edited via Dev app");
    setShowDiff(false);
    setNote("");
  }

  return (
    <div className="devapp__editor">
      <textarea
        className="field devapp__codearea devapp__codearea--big mono"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setShowDiff(false);
        }}
        spellCheck={false}
        rows={14}
      />
      <div className="devapp__editoractions">
        <button
          className="btn btn--sm btn--ghost"
          disabled={!dirty}
          onClick={() => setShowDiff((v) => !v)}
        >
          {showDiff ? "Hide diff" : "Preview diff"}
        </button>
        <button className="btn btn--sm btn--ghost" disabled={!dirty} onClick={() => setDraft(artifact.code)}>
          Revert to v{artifact.version}
        </button>
      </div>

      {showDiff && (
        <div className="devapp__diffpanel">
          <DiffView diff={diff} />
          <div className="devapp__applyrow">
            <input
              className="field"
              placeholder="Note for this change (what and why)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn btn--sm btn--primary" onClick={apply} disabled={!dirty}>
              Apply as v{artifact.version + 1}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------- detail -------------------------------------- */

function ArtifactDetail({ artifact }: { artifact: DevArtifact }) {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<SandboxRun | null>(null);
  const [placedNote, setPlacedNote] = useState<string | null>(null);
  const runs = listRuns(artifact.id);
  const gate = canInstall(artifact.id);
  const shownRun = lastRun ?? runs[0];

  async function runSandbox() {
    setRunning(true);
    const run = await runInSandbox(artifact.id);
    setLastRun(run);
    setRunning(false);
  }

  function placeOnDesktop() {
    const tile = addTile("devwidget", { settings: { artifactId: artifact.id } });
    setPlacedNote(tile ? `Placed “${artifact.manifest.name}” on the desktop.` : "Could not place the tile.");
  }

  return (
    <div className="devapp__detail">
      <header className="devapp__detailhead">
        <h2 className="devapp__detailname">{artifact.manifest.name}</h2>
        <span className={`devapp__status devapp__status--${artifact.status} mono`}>
          {STATUS_LABELS[artifact.status]}
        </span>
      </header>
      <p className="muted">{artifact.manifest.description}</p>
      <p className="mono faint devapp__facts">
        {artifact.manifest.kind} · v{artifact.version} · by {artifact.provenance.createdBy}
        {artifact.provenance.model ? ` (${artifact.provenance.model})` : ""} · updated{" "}
        {formatDateTime(artifact.updatedAt)}
      </p>
      {artifact.manifest.permissions.length > 0 && (
        <p className="mono faint devapp__facts">permissions: {artifact.manifest.permissions.join(", ")}</p>
      )}

      <Section title="Code">
        <CodeEditor artifact={artifact} />
      </Section>

      <Section title="Validation">
        <Toolbar>
          <button className="btn btn--sm btn--ghost" onClick={() => validateArtifact(artifact.id)}>
            Validate
          </button>
        </Toolbar>
        {artifact.lastValidation ? (
          <ul className="devapp__checks">
            {artifact.lastValidation.checks.map((c) => (
              <li key={c.name} className={c.passed ? "" : c.advisory ? "is-advisory" : "is-failed"}>
                {c.passed ? "✓" : "✗"} {c.name}
                {c.detail ? ` — ${c.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint">Not yet validated for the current code.</p>
        )}
      </Section>

      <Section title="Sandbox">
        <Toolbar>
          <button className="btn btn--sm btn--ghost" onClick={runSandbox} disabled={running}>
            {running ? "Running…" : "Run in sandbox"}
          </button>
        </Toolbar>
        {shownRun ? (
          <div>
            <p className="mono faint">
              {shownRun.ok ? "ok" : "failed"} · {shownRun.durationMs}ms
            </p>
            <ul className="devapp__checks">
              {shownRun.logs.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="faint">Not yet run.</p>
        )}
      </Section>

      <Section title="Install">
        <Toolbar>
          {artifact.status === "installed" ? (
            <button className="btn btn--sm btn--ghost" onClick={() => uninstallArtifact(artifact.id)}>
              Uninstall
            </button>
          ) : (
            <button
              className="btn btn--sm btn--ghost"
              disabled={!gate.ok}
              title={gate.ok ? "Install" : gate.reason}
              onClick={() => installArtifact(artifact.id)}
            >
              Install
            </button>
          )}
          {artifact.manifest.kind === "widget" && artifact.status === "installed" && (
            <button className="btn btn--sm btn--ghost" onClick={placeOnDesktop}>
              Place on desktop
            </button>
          )}
        </Toolbar>
        {!gate.ok && artifact.status !== "installed" && (
          <p className="faint mono">Install refused: {gate.reason}</p>
        )}
        {placedNote && <p className="faint mono">{placedNote}</p>}
      </Section>

      {artifact.versions.length > 0 && (
        <Section title="Version history">
          <ul className="devapp__versions">
            {artifact.versions.map((v) => (
              <li key={v.version}>
                <button className="btn btn--sm btn--ghost" onClick={() => rollbackArtifact(artifact.id, v.version)}>
                  Roll back to v{v.version}
                </button>
                <span className="faint mono devapp__versionnote">
                  {v.note} · {formatDateTime(v.at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Remove">
        <button
          className="btn btn--sm btn--ghost devapp__danger"
          onClick={() => {
            if (window.confirm(`Remove artifact “${artifact.manifest.name}”? This cannot be undone.`)) {
              removeArtifact(artifact.id);
            }
          }}
        >
          Remove artifact
        </button>
      </Section>
    </div>
  );
}

/* ----------------------------------------- app ---------------------------------------- */

export default function DevApp() {
  const artifacts = useSyncExternalStore(subscribeArtifacts, listArtifacts);
  const [selectedId, setSelectedId] = useState("");
  const selected: DevArtifact | undefined = getArtifact(selectedId) ?? artifacts[0];

  return (
    <div className="devapp">
      <p className="devapp__intro">
        Create, edit, validate, sandbox-run, and install generated software artifacts — the pipeline Dev
        Core governs. Installed widgets can be placed on the desktop as sandboxed <code className="mono">devwidget</code>{" "}
        tiles.
      </p>

      <div className="devapp__layout">
        <div className="devapp__side">
          <CreateForm onCreated={setSelectedId} />
          <ArtifactList
            artifacts={artifacts}
            selectedId={selected?.id ?? ""}
            onSelect={setSelectedId}
          />
        </div>
        <div className="devapp__main">
          {selected ? (
            <ArtifactDetail key={selected.id} artifact={selected} />
          ) : (
            <EmptyState title="No artifact selected" hint="Create one to get started." />
          )}
        </div>
      </div>

      <FutureNote
        items={[
          "typecheck/lint/test runners for generated code",
          "dependency bundling beyond the allowlist",
          "a widget write-path RPC via AI proposals (today the RPC is read-only)",
        ]}
      />
    </div>
  );
}
