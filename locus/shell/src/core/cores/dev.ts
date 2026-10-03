/*
 * Dev Core — the system contract for software creation (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: code artifacts, generated apps, widgets, anchors, manifests, diffs,
 * previews, sandboxed execution, validation, packaging, dependency policy,
 * provenance, and rollback. Editor Core can edit text; Dev Core understands
 * runnable software and governs generated behavior.
 *
 * The governed pipeline the AI must use to build inside Locus:
 *
 *   create a draft artifact (with provenance: prompt, model, creator)
 *     → show the diff (Editor Core's shared diff grammar)
 *     → declare a capability manifest (checked by Security Core policy)
 *     → validate (manifest, dependencies, forbidden globals, secret leaks, size)
 *     → run in a real sandbox (an isolated iframe: no OS storage, no DOM,
 *       no network identity; console + errors captured, time-limited)
 *     → and only then install into the artifact registry.
 *
 * Every version is kept as a rollback point and every step is audited, so
 * the chain of custody for generated software is inspectable after the fact.
 */

import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { emit } from "../events";
import { registerExternalExecutor, type ExecutorOutcome } from "../broker";
import { deliver } from "./notification";
import { diffLines, type DiffLine } from "./editor";
import { detectSecrets, redactText } from "./secrets";
import { evaluateManifest, SANDBOX_POLICY, type CapabilityManifest } from "./security";
import { describeUpcoming } from "./time";
import { allCards } from "./cardspoke";

/** A cheap deterministic content hash (FNV-1a) that binds a run/validation to
    the exact code it covered — timestamps alone cannot tell same-millisecond
    or cross-tab edits apart, so a stale run could pass the install gate. */
function hashCode(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/* ---------------------------------- model ----------------------------------- */

export type ArtifactKind = "app" | "widget" | "anchor" | "snippet";

/** The manifest a generated artifact declares — its contract with the OS. */
export interface DevManifest extends CapabilityManifest {
  name: string;
  kind: ArtifactKind;
  description: string;
}

/** Where an artifact came from — the provenance the audit trail leans on. */
export interface Provenance {
  createdBy: "user" | "ai";
  /** The prompt that produced it, when AI-generated. */
  prompt?: string;
  /** Model/provider used, when AI-generated. */
  model?: string;
  contextNote?: string;
}

/** A kept prior state — the rollback point. */
export interface ArtifactVersion {
  version: number;
  code: string;
  note: string;
  at: number;
}

export type ArtifactStatus = "draft" | "validated" | "rejected" | "installed";

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
  /** Advisory checks inform but do not fail validation — runtime policy
      (the sandbox CSP) is the enforcement, not the source regex. */
  advisory?: boolean;
}

export interface ValidationReport {
  ok: boolean;
  at: number;
  checks: ValidationCheck[];
  /** The code hash this report validated, so a later edit invalidates it. */
  codeHash?: string;
}

export interface DevArtifact {
  id: string;
  manifest: DevManifest;
  /** Current source. Plain JavaScript for the sandbox runner. */
  code: string;
  version: number;
  status: ArtifactStatus;
  provenance: Provenance;
  /** Prior versions, newest first — rollback points. */
  versions: ArtifactVersion[];
  lastValidation?: ValidationReport;
  installedAt?: number;
  createdAt: number;
  updatedAt: number;
  /** When the CODE last changed. `updatedAt` moves on any patch (validation,
      install), which must not invalidate a sandbox run of unchanged code. */
  codeUpdatedAt?: number;
  /** Content hash of the current code — the identity a run/validation binds to. */
  codeHash?: string;
}

export interface SandboxRun {
  id: string;
  artifactId: string;
  at: number;
  ok: boolean;
  logs: string[];
  durationMs: number;
  /** The code hash this run actually executed, for a stale-proof install gate. */
  codeHash?: string;
}

const RUN_LIMIT = 40;
let seq = 0;
function makeId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

let artifactCache: DevArtifact[] | null = null;
let runCache: SandboxRun[] | null = null;

function loadArtifacts(): DevArtifact[] {
  if (artifactCache === null) artifactCache = storage.get<DevArtifact[]>(StoreKeys.devArtifacts, []);
  return artifactCache;
}
function saveArtifacts(next: DevArtifact[]): void {
  artifactCache = next;
  storage.set(StoreKeys.devArtifacts, next);
}
function loadRuns(): SandboxRun[] {
  if (runCache === null) runCache = storage.get<SandboxRun[]>(StoreKeys.devRuns, []);
  return runCache;
}
function saveRuns(next: SandboxRun[]): void {
  runCache = next.slice(0, RUN_LIMIT);
  storage.set(StoreKeys.devRuns, runCache);
}

export function listArtifacts(): DevArtifact[] {
  return loadArtifacts();
}
export function getArtifact(id: string): DevArtifact | undefined {
  return loadArtifacts().find((a) => a.id === id);
}
export function listRuns(artifactId?: string): SandboxRun[] {
  return artifactId ? loadRuns().filter((r) => r.artifactId === artifactId) : loadRuns();
}
export function subscribeArtifacts(fn: () => void): () => void {
  const u1 = storage.subscribe(StoreKeys.devArtifacts, () => {
    artifactCache = storage.get<DevArtifact[]>(StoreKeys.devArtifacts, []);
    fn();
  });
  const u2 = storage.subscribe(StoreKeys.devRuns, () => {
    runCache = storage.get<SandboxRun[]>(StoreKeys.devRuns, []);
    fn();
  });
  return () => {
    u1();
    u2();
  };
}

/* --------------------------------- lifecycle -------------------------------- */

export interface CreateArtifactInput {
  name: string;
  kind: ArtifactKind;
  description: string;
  code: string;
  permissions?: string[];
  dependencies?: string[];
  network?: boolean;
  provenance: Provenance;
}

export function createArtifact(input: CreateArtifactInput): DevArtifact {
  // Enforce the size cap BEFORE persisting — validation caught it, but only
  // after arbitrary (possibly huge) bytes were already written to storage,
  // which a rejected draft could use to fill the quota immediately.
  const bytes = new TextEncoder().encode(input.code).length;
  if (bytes > SANDBOX_POLICY.maxArtifactBytes) {
    throw new Error(
      `Artifact code is ${bytes} bytes — over the ${SANDBOX_POLICY.maxArtifactBytes}-byte limit; not stored`,
    );
  }
  const now = Date.now();
  const artifact: DevArtifact = {
    id: makeId("dev"),
    manifest: {
      name: input.name.trim() || "Untitled artifact",
      kind: input.kind,
      description: input.description.trim(),
      permissions: input.permissions ?? [],
      dependencies: input.dependencies ?? [],
      network: input.network ?? false,
    },
    code: input.code,
    version: 1,
    status: "draft",
    provenance: input.provenance,
    versions: [],
    createdAt: now,
    updatedAt: now,
    codeUpdatedAt: now,
    codeHash: hashCode(input.code),
  };
  saveArtifacts([artifact, ...loadArtifacts()]);
  record({
    type: "dev.artifact.created",
    summary: `Dev Core: ${artifact.manifest.kind} created — “${artifact.manifest.name}” (by ${input.provenance.createdBy})`,
    detail: input.provenance.prompt ? `Prompt: ${input.provenance.prompt}` : undefined,
  });
  return artifact;
}

function patchArtifact(id: string, patch: Partial<DevArtifact>): DevArtifact | undefined {
  let out: DevArtifact | undefined;
  saveArtifacts(
    loadArtifacts().map((a) => {
      if (a.id !== id) return a;
      out = { ...a, ...patch, updatedAt: Date.now() };
      return out;
    }),
  );
  return out;
}

/** Rollback points kept per artifact. Old versions beyond this are dropped —
    the cap is policy, stated here and in the registry, not "every version". */
export const VERSION_HISTORY_LIMIT = 25;

/**
 * Change an artifact's code. The prior state is kept as a rollback point,
 * the version bumps, and the artifact drops back to draft — edited code must
 * re-validate before it can run or stay installed.
 */
export function updateArtifactCode(id: string, code: string, note: string): DevArtifact | undefined {
  const a = getArtifact(id);
  if (!a || a.code === code) return a;
  // Reject oversize BEFORE persisting (see createArtifact) so a rejected draft
  // cannot balloon storage — the prior code stays as-is.
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > SANDBOX_POLICY.maxArtifactBytes) {
    record({
      type: "system.event",
      summary: `Dev Core: update refused — “${a.manifest.name}” code is ${bytes} bytes (over the limit)`,
    });
    return a;
  }
  const kept: ArtifactVersion = { version: a.version, code: a.code, note, at: Date.now() };
  const updated = patchArtifact(id, {
    code,
    version: a.version + 1,
    status: "draft",
    versions: [kept, ...a.versions].slice(0, VERSION_HISTORY_LIMIT),
    lastValidation: undefined,
    installedAt: undefined,
    codeUpdatedAt: Date.now(),
    codeHash: hashCode(code),
  });
  record({
    type: "dev.artifact.updated",
    summary: `Dev Core: “${a.manifest.name}” updated to v${a.version + 1} — ${note}`,
  });
  return updated;
}

/** The generated-change preview: Editor Core's shared diff grammar. */
export function diffArtifact(id: string, newCode: string): DiffLine[] {
  const a = getArtifact(id);
  return a ? diffLines(a.code, newCode) : [];
}

/** Restore a kept version. The current state becomes a rollback point too.
    Rolling back to code identical to the current state is a no-op and is
    not recorded as a rollback (nothing changed). */
export function rollbackArtifact(id: string, version: number): DevArtifact | undefined {
  const a = getArtifact(id);
  const target = a?.versions.find((v) => v.version === version);
  if (!a || !target) return undefined;
  if (a.code === target.code) return a;
  const updated = updateArtifactCode(id, target.code, `Rolled back to v${version}`);
  record({
    type: "dev.rolledback",
    summary: `Dev Core: “${a.manifest.name}” rolled back to v${version}`,
  });
  return updated;
}

export function removeArtifact(id: string): void {
  const a = getArtifact(id);
  saveArtifacts(loadArtifacts().filter((x) => x.id !== id));
  if (a) record({ type: "dev.removed", summary: `Dev Core: “${a.manifest.name}” removed` });
}

/* --------------------------------- validation ------------------------------- */

// Lazy, not module-top-level: dev.ts <-> security.ts is a circular import
// (security.ts's dev.ts-reachable dependents load before SANDBOX_POLICY is
// assigned, depending on which module the app happens to load first), so
// reading SANDBOX_POLICY at import time can see it mid-initialization.
// Deferring the read into validateArtifact (called only after boot) sidesteps
// module-init ordering entirely.
let identGlobalsCache: string[] | null = null;
function identGlobals(): string[] {
  if (!identGlobalsCache) {
    identGlobalsCache = SANDBOX_POLICY.forbiddenGlobals.filter((g) => !g.includes("."));
  }
  return identGlobalsCache;
}

/**
 * Validate an artifact against Dev Core checks and Security Core policy:
 * manifest completeness, dependency allowlist, network policy, forbidden
 * globals in the source, secret leaks, and size. Sets validated/rejected.
 */
export function validateArtifact(id: string): ValidationReport | null {
  const a = getArtifact(id);
  if (!a) return null;
  const checks: ValidationCheck[] = [];

  const manifestComplete = !!a.manifest.name && !!a.manifest.description;
  checks.push({
    name: "Manifest complete",
    passed: manifestComplete,
    detail: manifestComplete ? undefined : "Name and description are required",
  });

  const verdict = evaluateManifest(a.manifest);
  checks.push({
    name: "Capability manifest within policy",
    passed: verdict.allowed,
    detail: [...verdict.violations, ...verdict.requiresApproval].join("; ") || undefined,
  });

  // Advisory: a source regex is trivially defeated (globalThis["fe"+"tch"]).
  // The real enforcement is the sandbox CSP — this check only informs review.
  const hit = identGlobals().find((g) => new RegExp(`\\b${g}\\b`).test(a.code)) ??
    (/document\s*\.\s*cookie/.test(a.code) ? "document.cookie" : undefined);
  checks.push({
    name: "No forbidden globals (advisory — the sandbox CSP enforces)",
    passed: !hit,
    advisory: true,
    detail: hit ? `Uses “${hit}” — generated code talks to the OS through Cores` : undefined,
  });

  const leaks = detectSecrets(a.code);
  checks.push({
    name: "No embedded secrets",
    passed: leaks.length === 0,
    detail: leaks.length ? leaks.map((l) => l.name).join(", ") : undefined,
  });

  const size = new TextEncoder().encode(a.code).length;
  checks.push({
    name: "Reviewable size",
    passed: size <= SANDBOX_POLICY.maxArtifactBytes,
    detail: size > SANDBOX_POLICY.maxArtifactBytes ? `${size} bytes (max ${SANDBOX_POLICY.maxArtifactBytes})` : undefined,
  });

  const report: ValidationReport = {
    ok: checks.every((c) => c.passed || c.advisory),
    at: Date.now(),
    checks,
    codeHash: a.codeHash ?? hashCode(a.code),
  };
  patchArtifact(id, { lastValidation: report, status: report.ok ? "validated" : "rejected" });
  record({
    type: "dev.validated",
    summary: `Dev Core: validation ${report.ok ? "passed" : "FAILED"} — “${a.manifest.name}” v${a.version}`,
    detail: checks
      .filter((c) => !c.passed)
      .map((c) => `${c.name}: ${c.detail ?? "failed"}`)
      .join("; ") || undefined,
    skipEmit: true, // the typed bus event below carries the report
  });
  emit("dev.validated", { artifactId: id, report });
  return report;
}

/* ----------------------------- sandboxed execution --------------------------- */

/** Embed a value in inline script text. JSON.stringify alone does not escape
    `<`, so code containing "</script>" could terminate the harness element —
    the classic srcdoc breakout. Escaping `<` closes it. */
function embedInScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Run an artifact in a real sandbox, defense in depth:
 *  - an iframe with `sandbox="allow-scripts"` and no `allow-same-origin` —
 *    opaque origin: no Locus storage, no parent DOM, no cookies;
 *  - a srcdoc CSP (`default-src 'none'`) so "network deny" is enforced at
 *    runtime — `allow-scripts` alone would still permit fetch/WebSocket;
 *  - execution inside a Worker created by the iframe (inheriting its CSP),
 *    so a `while(true)` artifact is terminated at the deadline instead of
 *    hanging the OS event loop;
 *  - verdict integrity (Wave 3): the worker binds a PRIVATE postMessage
 *    reference in a closure, then deletes the global (and its prototype
 *    slot) before artifact code runs, and every harness message carries a
 *    per-run nonce the artifact can never read (closures are invisible to
 *    `new Function` code). An artifact calling `send("done")`, postMessage,
 *    or any re-acquired channel cannot forge a successful run — the iframe
 *    drops messages without the nonce.
 *  - async honesty: uncaught worker errors and unhandled rejections fail the
 *    run, and success is declared only after a short settle window so an
 *    immediately-failing async artifact does not read as "ok".
 * Console output and errors stream back over postMessage; the run is
 * time-limited and recorded. Only validated (or installed) artifacts may run.
 */
export function runInSandbox(id: string, timeoutMs = 3000): Promise<SandboxRun> {
  const a = getArtifact(id);
  const started = Date.now();

  const finishRecorded = (ok: boolean, logs: string[], durationMs: number): SandboxRun => {
    const run: SandboxRun = {
      id: makeId("run"),
      artifactId: id,
      at: started,
      ok,
      logs: logs.slice(0, 50),
      durationMs,
      codeHash: a?.codeHash,
    };
    saveRuns([run, ...loadRuns()]);
    record({
      type: "dev.sandbox.run",
      summary: `Dev Core: sandbox run ${ok ? "ok" : "failed"} — “${a?.manifest.name ?? id}” (${durationMs}ms)`,
      skipEmit: true, // the typed bus event below carries the run
    });
    emit("dev.sandbox.run", run);
    return run;
  };

  if (!a) {
    return Promise.resolve(finishRecorded(false, ["Artifact not found"], 0));
  }
  if (a.status !== "validated" && a.status !== "installed") {
    return Promise.resolve(
      finishRecorded(false, ["Refused: the artifact must pass validation before it can run"], 0),
    );
  }

  return new Promise((resolve) => {
    const token = makeId("tok");
    // The per-run completion nonce: lives only in harness closures (iframe
    // script + worker IIFE), never in any scope artifact code can read.
    const nonce = `${makeId("non")}-${Math.random().toString(36).slice(2, 10)}`;
    const logs: string[] = [];
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      iframe.remove();
    };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(finishRecorded(ok, logs, Date.now() - started));
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const d = e.data as { token?: string; type?: string; text?: string };
      if (!d || d.token !== token) return;
      if (d.type === "log") logs.push(String(d.text ?? "").slice(0, 500));
      else if (d.type === "error") {
        logs.push(`Error: ${String(d.text ?? "").slice(0, 500)}`);
        finish(false);
      } else if (d.type === "done") finish(true);
    };
    const timer = window.setTimeout(() => {
      logs.push(`Timed out after ${timeoutMs}ms`);
      finish(false);
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    // The code, token, and nonce are embedded with `<` escaped, so artifact
    // source containing "</script>" cannot terminate the harness element. The
    // CSP denies all network/storage; the Worker isolates the event loop.
    const innerTimeout = Math.max(500, timeoutMs - 500);
    iframe.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:"><script>
      (function () {
        var TOKEN = ${embedInScript(token)};
        var NONCE = ${embedInScript(nonce)};
        var CODE = ${embedInScript(a.code)};
        function send(type, text) { parent.postMessage({ token: TOKEN, type: type, text: String(text) }, "*"); }
        var workerSrc =
          // Verdict isolation: bind the ONLY usable channel in a closure,
          // then remove postMessage from the global AND its prototype before
          // any artifact code can run. Every harness message carries the
          // per-run nonce; artifact code (evaluated via new Function, which
          // sees only the global scope) can reach neither the binding nor
          // the nonce, so it cannot forge "done".
          '(function () {' +
          '  var NONCE = ' + JSON.stringify(NONCE) + ';' +
          '  var post = self.postMessage.bind(self);' +
          '  try { delete Object.getPrototypeOf(self).postMessage; } catch (e) {}' +
          '  try { self.postMessage = function () { post({ nonce: NONCE, type: "log", text: "[sandbox] artifact called postMessage directly - blocked" }); }; } catch (e) {}' +
          '  function send(type, text) { post({ nonce: NONCE, type: type, text: String(text) }); }' +
          '  ["log","info","warn","error"].forEach(function (level) {' +
          '    console[level] = function () { send("log", "[" + level + "] " + Array.prototype.map.call(arguments, String).join(" ")); };' +
          '  });' +
          '  var settled = false;' +
          '  function fail(msg) { if (!settled) { settled = true; send("error", msg); } }' +
          '  self.addEventListener("error", function (e) { fail((e && e.message) || "Uncaught error"); });' +
          '  self.addEventListener("unhandledrejection", function (e) { fail((e && e.reason && e.reason.message) || "Unhandled rejection"); });' +
          '  self.onmessage = function (e) {' +
          '    var code = e.data;' +
          '    try {' +
          '      new Function(code)();' +
          // Success only after a settle window, so an immediately-failing
          // async artifact (queued rejection, microtask throw) fails honestly.
          '      setTimeout(function () { if (!settled) { settled = true; send("done", ""); } }, 30);' +
          '    } catch (err) { fail(err && err.message ? err.message : String(err)); }' +
          '  };' +
          '})();';
        try {
          var worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" })));
          var settled = false;
          worker.onmessage = function (e) {
            var d = e.data || {};
            // Nonce gate: a message without this run's nonce did not come
            // from the harness closure — drop it (forged-verdict guard).
            if (d.nonce !== NONCE) return;
            if (d.type === "done" || d.type === "error") { settled = true; worker.terminate(); }
            send(d.type, d.text);
          };
          worker.onerror = function (e) {
            settled = true;
            worker.terminate();
            send("error", (e && e.message) || "Worker error");
          };
          setTimeout(function () {
            if (!settled) { worker.terminate(); send("error", "Terminated: exceeded the time limit"); }
          }, ${innerTimeout});
          worker.postMessage(CODE);
        } catch (err) {
          send("error", "Sandbox setup failed: " + (err && err.message ? err.message : String(err)));
        }
      })();
    <\/script>`;
    document.body.appendChild(iframe);
  });
}

/* ------------------------------ devwidget runtime ---------------------------- */
/*
 * The devwidget tile runtime: what an INSTALLED widget artifact may ask the
 * OS for once it is placed on the desktop. This is deliberately much
 * narrower than a Core API — a fixed, typed, read-only request vocabulary,
 * each entry gated by a manifest permission the artifact must have declared
 * (and had reviewed) before install. Unlike runInSandbox's throwaway Worker
 * (which proves code safety, not runtime data), the widget iframe built by
 * buildWidgetSrcdoc keeps a live postMessage channel to the OS for exactly
 * these requests — routed through handleWidgetRpc, never a direct Core call
 * from the sandboxed frame.
 */

/** One widget RPC request kind: the permission it requires and what it does. */
export interface WidgetRpcKindDef {
  requiredPermission: string;
  describe: string;
}

/** The full, fixed vocabulary of `locus.request(kind)` calls a devwidget may
    make. Adding a kind here is a policy decision — it is what "sandboxed
    generated software may read" means in practice. */
export const WIDGET_RPC_KINDS: Record<string, WidgetRpcKindDef> = {
  "time.upcoming": {
    requiredPermission: "time.read",
    describe: "The next few upcoming Time Core entries, as short lines.",
  },
  "tasks.summary": {
    requiredPermission: "cardspoke.read",
    describe: "A short open/done task count from the Cardspoke object store.",
  },
};

/** Produce the data for one RPC kind. Only called after handleWidgetRpc has
    already checked the artifact is installed and holds the permission. */
async function resolveWidgetRpc(kind: string): Promise<string> {
  if (kind === "time.upcoming") {
    const lines = describeUpcoming(3);
    return lines.length ? lines.join(" · ") : "Nothing upcoming.";
  }
  if (kind === "tasks.summary") {
    const tasks = allCards().filter((o) => o.type === "task");
    const open = tasks.filter((o) => !o.task?.done).length;
    return `${open} open · ${tasks.length - open} done`;
  }
  return "";
}

/**
 * Handle one `locus.request(kind)` call from a devwidget iframe. Fails
 * closed: an unknown artifact, an artifact that is not currently installed,
 * an unrecognized kind, or a kind whose required permission the artifact did
 * not declare in its manifest are all refused — and the refusal is audited
 * (successful requests are not, to keep the log signal, not noise).
 */
export async function handleWidgetRpc(
  artifactId: string,
  kind: string,
): Promise<{ ok: true; data: string } | { ok: false; reason: string }> {
  const deny = (reason: string, summary: string): { ok: false; reason: string } => {
    record({ type: "dev.widget.denied", summary, detail: reason });
    return { ok: false, reason };
  };

  const a = getArtifact(artifactId);
  if (!a) {
    return deny("Unknown artifact", `Dev Core: widget RPC denied — unknown artifact requested “${kind}”`);
  }
  if (a.status !== "installed") {
    return deny(
      "Artifact is not installed",
      `Dev Core: widget RPC denied — “${a.manifest.name}” is not installed (requested “${kind}”)`,
    );
  }
  const def = WIDGET_RPC_KINDS[kind];
  if (!def) {
    return deny(
      "Unknown request kind",
      `Dev Core: widget RPC denied — “${a.manifest.name}” requested unknown kind “${kind}”`,
    );
  }
  if (!a.manifest.permissions.includes(def.requiredPermission)) {
    return deny(
      `Missing declared permission: ${def.requiredPermission}`,
      `Dev Core: widget RPC denied — “${a.manifest.name}” lacks “${def.requiredPermission}” for “${kind}”`,
    );
  }
  const data = await resolveWidgetRpc(kind);
  return { ok: true, data: redactText(data) };
}

/**
 * Build the sandboxed document a devwidget tile mounts: an opaque-origin
 * iframe (no `allow-same-origin`) whose srcdoc CSP allows only inline
 * script/style plus 'unsafe-eval' (the bootstrap runs the artifact through
 * `new Function`, same as runInSandbox's harness) — no network, no external
 * anything (`default-src 'none'` covers fetch/XHR/WebSocket). The bootstrap exposes
 * `locus.request(kind)`, the artifact's only channel off the page: it posts
 * `{ token, seq, kind, type: "locus-widget-rpc" }` to the parent and resolves
 * when the parent (the DevWidgetTile component, gated through
 * handleWidgetRpc) posts back `{ token, seq, ok, data|reason }`. The token is
 * the gate — the origin is opaque so `"*"` is the only target `postMessage`
 * can use. The artifact code itself is embedded with the same `<` escaping
 * runInSandbox uses, so `</script>` in generated source cannot break out.
 */
export function buildWidgetSrcdoc(artifact: DevArtifact, token: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'">
<body></body>
<script>
  (function () {
    var TOKEN = ${embedInScript(token)};
    var seq = 0;
    var pending = {};
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.token !== TOKEN || typeof d.seq !== "number") return;
      var cb = pending[d.seq];
      if (!cb) return;
      delete pending[d.seq];
      if (d.ok) cb.resolve(d.data); else cb.reject(new Error(d.reason || "request failed"));
    });
    window.locus = {
      request: function (kind) {
        var s = ++seq;
        return new Promise(function (resolve, reject) {
          pending[s] = { resolve: resolve, reject: reject };
          parent.postMessage({ token: TOKEN, seq: s, kind: kind, type: "locus-widget-rpc" }, "*");
        });
      },
    };
    try {
      new Function(${embedInScript(artifact.code)})();
    } catch (err) {
      document.body.textContent = "Widget error: " + (err && err.message ? err.message : String(err));
    }
  })();
<\/script>`;
}

/* ---------------------------------- packaging -------------------------------- */

/** Can this artifact install right now? Install requires both a passing
    validation AND a successful sandbox run of the *current* code. */
export function canInstall(id: string): { ok: boolean; reason?: string } {
  const a = getArtifact(id);
  if (!a) return { ok: false, reason: "Artifact not found" };
  if (a.status === "installed") return { ok: false, reason: "Already installed" };
  if (a.status !== "validated") {
    return { ok: false, reason: "Validation has not passed for the current code" };
  }
  // The validation on record must cover the CURRENT code (content hash), not
  // merely be the latest report — an edit invalidates it even at the same ms.
  if (a.codeHash && a.lastValidation?.codeHash && a.lastValidation.codeHash !== a.codeHash) {
    return { ok: false, reason: "The code changed after the last validation — validate again" };
  }
  const lastRun = loadRuns().find((r) => r.artifactId === id);
  if (!lastRun) return { ok: false, reason: "The current code has not been sandbox-run" };
  if (!lastRun.ok) return { ok: false, reason: "The latest sandbox run failed" };
  // Prefer a content-hash comparison (stale-proof against same-ms/cross-tab
  // edits); fall back to the timestamp for runs recorded before hashing.
  const staleByHash = a.codeHash && lastRun.codeHash && lastRun.codeHash !== a.codeHash;
  const staleByTime =
    (!a.codeHash || !lastRun.codeHash) && lastRun.at < (a.codeUpdatedAt ?? a.createdAt);
  if (staleByHash || staleByTime) {
    return { ok: false, reason: "The code changed after the last sandbox run — run it again" };
  }
  return { ok: true };
}

/**
 * Promote a validated, sandbox-tested artifact into the installed registry —
 * the packaging step. "Validated and sandbox-tested" is checked, not
 * claimed: install refuses until the latest run of the current code passed.
 * Installation is a user decision: AI proposes it through the broker
 * (AI Core routes "generate an app" intents here) and this runs on approval.
 */
export function installArtifact(id: string): DevArtifact | undefined {
  const a = getArtifact(id);
  if (!a) return undefined;
  const gate = canInstall(id);
  if (!gate.ok) {
    record({
      type: "system.event",
      summary: `Dev Core: install refused — “${a.manifest.name}”`,
      detail: gate.reason,
    });
    return undefined;
  }
  const updated = patchArtifact(id, { status: "installed", installedAt: Date.now() });
  record({
    type: "dev.installed",
    summary: `Dev Core: installed ${a.manifest.kind} — “${a.manifest.name}” v${a.version}`,
    skipEmit: true, // the typed bus event below carries the artifact
  });
  emit("dev.installed", updated);
  deliver({
    title: `Installed: ${a.manifest.name}`,
    detail: `${a.manifest.kind} v${a.version}, validated and sandbox-tested.`,
    source: "Dev",
  });
  return updated;
}

export function uninstallArtifact(id: string): DevArtifact | undefined {
  const a = getArtifact(id);
  if (!a || a.status !== "installed") return undefined;
  const updated = patchArtifact(id, { status: "validated", installedAt: undefined });
  record({ type: "dev.uninstalled", summary: `Dev Core: uninstalled “${a.manifest.name}”` });
  return updated;
}

/** Installed artifacts — the generated-software registry surfaces render. */
export function installedArtifacts(): DevArtifact[] {
  return loadArtifacts().filter((a) => a.status === "installed");
}

/** Boot: register the executor that makes AI-proposed installs real — the
    AI proposes a `dev.install` external effect naming the artifact, the
    user approves it in the broker, and only then does install run (still
    behind canInstall's validation + sandbox-run gate). */
let devStarted = false;
export function initDevCore(): void {
  if (devStarted) return;
  devStarted = true;
  registerExternalExecutor("dev.install", (proposal): ExecutorOutcome => {
    const id = proposal.effect.targetId;
    const a = id ? getArtifact(id) : undefined;
    if (!a) {
      return { status: "failed", detail: "The artifact no longer exists — nothing was installed." };
    }
    const installed = installArtifact(a.id);
    // A refused install is a FAILED outcome, not a silent "executed" — the
    // broker records the truthful result now that executors return outcomes.
    return installed
      ? { status: "succeeded", resultId: a.id, detail: `Installed “${a.manifest.name}” v${installed.version}.` }
      : { status: "failed", detail: `Install refused: ${canInstall(a.id).reason ?? "the install gate said no"}.` };
  });
}

/* ------------------------------------- AI ------------------------------------ */

/** One artifact, described for AI context: manifest, status, provenance. */
export function artifactForAI(id: string): string | null {
  const a = getArtifact(id);
  if (!a) return null;
  return [
    `${a.manifest.kind} “${a.manifest.name}” v${a.version} — ${a.status}`,
    a.manifest.description,
    a.manifest.permissions.length ? `permissions: ${a.manifest.permissions.join(", ")}` : "no permissions",
    `by ${a.provenance.createdBy}${a.provenance.model ? ` (${a.provenance.model})` : ""}`,
    a.lastValidation ? `validation: ${a.lastValidation.ok ? "passed" : "failed"}` : "not validated",
  ].join(" · ");
}

/* ------------------------------------ seed ----------------------------------- */

/**
 * Seed the cross-core example from the Core API Focus List — a deadline
 * widget that reads tasks (Cardspoke) and due dates (Time) — as a draft so
 * the pipeline is concrete from first boot. Nothing runs until it is
 * validated, and nothing installs until the user says so.
 *
 * The code is deliberately dual-mode: `runInSandbox`'s generic code-safety
 * check runs it in a Worker with no `document`/`locus` (there to prove the
 * code is well-behaved, not to render anything), while a placed devwidget
 * tile's iframe (buildWidgetSrcdoc) provides both. The `typeof` guards let
 * the same source pass the sandbox run AND do real work once placed —
 * without them the widget could never clear canInstall's sandbox-run gate.
 */
export function seedIfEmpty(): void {
  if (loadArtifacts().length > 0) return;
  createArtifact({
    name: "Deadline widget",
    kind: "widget",
    description:
      "Shows upcoming due dates and an open/done task count. Dates and recurrence come from Time Core; task counts from Cardspoke Core, over the devwidget RPC (locus.request).",
    code: [
      "// Deadline widget — placeable on the desktop once installed.",
      "// The sandbox run (validation) has no document/locus — this guard lets",
      "// the same source pass that check AND render for real once placed.",
      'if (typeof document !== "undefined" && typeof locus !== "undefined") {',
      "  var root = document.body;",
      '  root.style.fontFamily = "ui-monospace, monospace";',
      '  root.style.fontSize = "11px";',
      '  root.style.padding = "6px";',
      "  // The iframe cannot see Locus theme tokens; system colors track the",
      "  // OS light/dark preference so the text stays readable in both.",
      '  document.documentElement.style.colorScheme = "light dark";',
      '  root.style.color = "CanvasText";',
      "  var upcoming = document.createElement('div');",
      "  var tasks = document.createElement('div');",
      "  root.appendChild(upcoming);",
      "  root.appendChild(tasks);",
      "  upcoming.textContent = \"Loading…\";",
      "  tasks.textContent = \"Loading…\";",
      '  locus.request("time.upcoming").then(function (data) {',
      "    upcoming.textContent = data;",
      "  }, function () {",
      '    upcoming.textContent = "Upcoming: unavailable";',
      "  });",
      '  locus.request("tasks.summary").then(function (data) {',
      "    tasks.textContent = data;",
      "  }, function () {",
      '    tasks.textContent = "Tasks: unavailable";',
      "  });",
      "} else {",
      '  console.log("Deadline widget — no document/locus here; it renders once placed as a devwidget tile.");',
      "}",
    ].join("\n"),
    permissions: ["cardspoke.read", "time.read"],
    dependencies: [],
    network: false,
    provenance: {
      createdBy: "ai",
      prompt: "Generate a deadline widget for my tasks",
      model: "local (placeholder)",
      contextNote: "The Focus List's cross-core example, seeded as a draft.",
    },
  });
}
