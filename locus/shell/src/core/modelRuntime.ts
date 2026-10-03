/*
 * Model Runtime — the single provider-adapter module (Phase 3 / M5, "First
 * Real Model Runtime").
 * ---------------------------------------------------------------------------
 * Every other Core in this build reasons *about* AI (routing, proposals,
 * context assembly); this is the one module allowed to actually talk to a
 * model endpoint over the network. Keeping that in one file means the
 * no-default-cloud-dependency rule has exactly one place to audit.
 *
 * Governance, restated as code:
 *  - Disabled by default. `canDispatch()` fails closed on every check, in a
 *    fixed order, before dispatchModelTurn() is allowed to touch `fetch` at
 *    all — a refused call never reaches the network.
 *  - A remote endpoint additionally requires the user to have set the AI
 *    provider to "cloud" AND ticked the explicit `allowRemote`
 *    acknowledgment — the "no local data to a remote host without a
 *    separate, explicit ack" rule made structural, not just a UI hint.
 *  - Raw API keys never live in this module's persisted config — only a
 *    `secret://` reference does. The actual value reaches this module
 *    exactly once per session, via Secrets Core's brokered `secrets.use`
 *    path: `initModelRuntime()` registers a Secrets consumer, and an
 *    approved `requestRuntimeKey()` proposal is the ONLY thing that ever
 *    calls it. The decrypted value is held in a module-local variable
 *    (never persisted, never logged, never returned to a caller) — the same
 *    "vault-unlock" shape as unlocking the secrets vault itself: one
 *    approval arms the runtime for the rest of the session.
 *  - Every dispatch is audited with the model, endpoint host, outcome, and
 *    timing — never the prompt, the response body, or the key.
 *  - Model writes never mutate anything directly: dispatchModelTurn() only
 *    returns text; turning a parsed action into a real change is
 *    assistant.ts's job, and it goes through the same proposeThroughCore
 *    door every rule-based proposal already uses.
 */

import { storage, StoreKeys } from "./storage";
import { isPrivateHost } from "./cores/web";
import { record } from "./audit";
import { registerSecretConsumer, requestSecretUse } from "./cores/secrets";
import type { ActionProposal, AIContextPacket } from "@/types";

/* ------------------------------- config ---------------------------------- */

export interface ModelRuntimeConfig {
  enabled: boolean;
  endpointUrl: string;
  model: string;
  /** A secret:// reference for an Authorization bearer token — never a raw key. */
  apiKeySecretRef?: string;
  /** Explicit, separate acknowledgment that a remote endpoint may receive
      assembled local context. Reset to false whenever the endpoint changes
      (setModelRuntimeConfig re-derives this) — a deliberate re-ack. */
  allowRemote: boolean;
}

const DEFAULT_CONFIG: ModelRuntimeConfig = {
  enabled: false,
  endpointUrl: "",
  model: "",
  allowRemote: false,
};

let cache: ModelRuntimeConfig | null = null;

function load(): ModelRuntimeConfig {
  if (cache === null) cache = storage.get<ModelRuntimeConfig>(StoreKeys.modelRuntime, DEFAULT_CONFIG);
  return cache;
}

function save(next: ModelRuntimeConfig): void {
  cache = next;
  storage.set(StoreKeys.modelRuntime, next);
}

export function getModelRuntimeConfig(): ModelRuntimeConfig {
  return load();
}

/**
 * Patch the config. Two deliberate side effects live here rather than in
 * every caller: changing the endpoint or the key reference invalidates
 * whatever is currently armed (a key approved for one endpoint must not
 * silently carry over to another), and changing the endpoint resets the
 * remote-acknowledgment flag unless the same call is the one setting it —
 * so switching endpoints always requires a fresh, explicit re-ack.
 */
export function setModelRuntimeConfig(patch: Partial<ModelRuntimeConfig>): ModelRuntimeConfig {
  const current = load();
  const endpointChanged = "endpointUrl" in patch && patch.endpointUrl !== current.endpointUrl;
  const refChanged = "apiKeySecretRef" in patch && patch.apiKeySecretRef !== current.apiKeySecretRef;
  const disabling = patch.enabled === false && current.enabled === true;
  const next: ModelRuntimeConfig = { ...current, ...patch };
  if (endpointChanged && !("allowRemote" in patch)) next.allowRemote = false;
  if (endpointChanged || refChanged || disabling) clearSessionKey();
  save(next);
  return next;
}

export function subscribeModelRuntime(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.modelRuntime, () => {
    cache = storage.get<ModelRuntimeConfig>(StoreKeys.modelRuntime, DEFAULT_CONFIG);
    fn();
  });
}

/* --------------------------- endpoint classification ---------------------- */

export type EndpointClass = "invalid" | "local" | "remote";

/** http(s) only, no embedded credentials; "local" iff the host resolves to a
    private/loopback/link-local destination (the same SSRF-safe rule Web
    Core's AI-fetch policy uses) — anything else is "remote". */
export function endpointClass(url: string): EndpointClass {
  const trimmed = url.trim();
  if (!trimmed) return "invalid";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "invalid";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "invalid";
  if (parsed.username || parsed.password) return "invalid"; // never carry credentials in the URL
  return isPrivateHost(parsed.hostname) ? "local" : "remote";
}

/* ------------------------------- dispatch gate ----------------------------- */

export type CanDispatchResult = { ok: true } | { ok: false; reason: string };

/** Shared fail-closed checks; `requireModel` is only skipped by
    canTestConnection(), which is otherwise the same gate ("a test ping is
    still a dispatch"). */
function evaluateGate(requireModel: boolean): CanDispatchResult {
  const config = load();
  if (!config.enabled) {
    return { ok: false, reason: "Model runtime is disabled." };
  }
  const provider = storage.get<string>(StoreKeys.aiProvider, "none");
  if (provider === "none") {
    return {
      ok: false,
      reason: "AI provider is set to None — choose On-device or Cloud in AI Control Center.",
    };
  }
  const cls = endpointClass(config.endpointUrl);
  if (cls === "invalid") {
    return {
      ok: false,
      reason: "Endpoint URL is missing or invalid — set an http(s) URL with no embedded credentials.",
    };
  }
  if (requireModel && !config.model.trim()) {
    return { ok: false, reason: "No model name is configured." };
  }
  if (cls === "remote") {
    if (provider !== "cloud") {
      return { ok: false, reason: "This endpoint is remote — set the AI provider to Cloud to allow it." };
    }
    if (!config.allowRemote) {
      return {
        ok: false,
        reason:
          "This endpoint is remote — assembled local context would leave this device. Acknowledge the remote-endpoint warning below to allow it.",
      };
    }
  }
  return { ok: true };
}

/** The dispatch gate: every check must pass, in order, before a model call
    is allowed to touch the network at all. */
export function canDispatch(): CanDispatchResult {
  return evaluateGate(true);
}

/** The same gate, minus the model-name check — used to enable "Test
    connection" (a reachability ping needs an endpoint/provider/ack, not a
    model name) while still refusing a remote ping without acknowledgment. */
export function canTestConnection(): CanDispatchResult {
  return evaluateGate(false);
}

/* ------------------------- session key (brokered use) ---------------------- */

/*
 * The vault-unlock precedent: one approved `secrets.use` proposal arms the
 * runtime for the rest of the session. The decrypted value never leaves this
 * module — it is held in memory only, cleared on endpoint/ref change or when
 * the runtime is disabled, and never persisted or logged.
 */
let sessionKey: string | null = null;
let initialized = false;

/** Idempotent boot registration — call once from main.tsx alongside the
    other Core inits. */
export function initModelRuntime(): void {
  if (initialized) return;
  initialized = true;
  registerSecretConsumer("model-runtime", (value) => {
    sessionKey = value;
  });
}

export function hasSessionKey(): boolean {
  return sessionKey !== null;
}

export function clearSessionKey(): void {
  sessionKey = null;
}

/** Ask to arm the runtime with the configured key ref — a real, user-visible
    secrets.use proposal, never a silent read. */
export async function requestRuntimeKey(): Promise<ActionProposal | null> {
  const config = load();
  if (!config.apiKeySecretRef) return null;
  return requestSecretUse({
    ref: config.apiKeySecretRef,
    purpose: "Model runtime authorization",
    consumer: "model-runtime",
  });
}

/* --------------------------------- dispatch -------------------------------- */

export type ModelDispatchResult =
  | { ok: true; text: string; model: string; endpointHost: string; durationMs: number }
  | { ok: false; reason: string };

const MAX_RESPONSE_CHARS = 20_000;
const DISPATCH_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 8_000;

/** Normalize a configured endpoint to its `/v1` base, without doubling a
    `/v1` the user already included. */
function v1Base(endpointUrl: string): string {
  const base = endpointUrl.trim().replace(/\/+$/, "");
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

function systemPromptFor(packet: AIContextPacket): string {
  const lines: string[] = [packet.userVisibilitySummary];
  if (packet.readableCapabilities.length) {
    lines.push("Readable capabilities:");
    for (const c of packet.readableCapabilities) lines.push(`- ${c.app}: ${c.label}`);
  }
  for (const cs of packet.coreSummaries) {
    if (!cs.lines.length) continue;
    lines.push(`${cs.core}:`);
    for (const line of cs.lines) lines.push(`- ${line}`);
  }
  lines.push(
    "Answer concisely from the provided local context only. Never invent data not present above. " +
      'If and only if the user asks to create or change something, reply with EXACTLY one fenced ```json ' +
      'code block of shape {"action":"create_task"|"create_note"|"set_reminder","title":string(<=200)} ' +
      '(create_note also allows "body" string <=4000; set_reminder instead has "text" <=200 and "when" ' +
      'string in place of "title") and nothing else — no prose before or after the block.',
  );
  return lines.join("\n");
}

function auditDispatch(input: { model: string; host: string; ok: boolean; durationMs: number }): void {
  record({
    type: "ai.dispatched",
    summary: `Model runtime dispatched to ${input.model} @ ${input.host} — ${
      input.ok ? "ok" : "failed"
    } (${input.durationMs}ms)`,
  });
}

function extractMessageContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/**
 * Dispatch one turn to the configured OpenAI-compatible endpoint. Refuses via
 * canDispatch() FIRST — a refused call never constructs a fetch, let alone
 * sends one. Fetch hygiene mirrors Web Core's AI-fetch precedent: no
 * credentials, no referrer, no cache, a hard timeout.
 */
export async function dispatchModelTurn(input: {
  prompt: string;
  packet: AIContextPacket;
  modelOverride?: string;
}): Promise<ModelDispatchResult> {
  const gate = canDispatch();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const config = load();
  const model = input.modelOverride?.trim() || config.model.trim();
  const url = `${v1Base(config.endpointUrl)}/chat/completions`;

  let host: string;
  try {
    host = new URL(config.endpointUrl.trim()).host;
  } catch {
    return { ok: false, reason: "Endpoint URL is invalid." };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionKey) headers.Authorization = `Bearer ${sessionKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPromptFor(input.packet) },
          { role: "user", content: input.prompt },
        ],
        stream: false,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    auditDispatch({ model, host, ok: false, durationMs });
    return { ok: false, reason: `network error — ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    auditDispatch({ model, host, ok: false, durationMs });
    return { ok: false, reason: `endpoint responded HTTP ${res.status}` };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    auditDispatch({ model, host, ok: false, durationMs });
    return { ok: false, reason: "response was not valid JSON" };
  }

  const content = extractMessageContent(data);
  if (content === null) {
    auditDispatch({ model, host, ok: false, durationMs });
    return { ok: false, reason: "response did not contain a message" };
  }

  auditDispatch({ model, host, ok: true, durationMs });
  return { ok: true, text: content.slice(0, MAX_RESPONSE_CHARS), model, endpointHost: host, durationMs };
}

/**
 * A reachability ping (`GET {endpoint}/v1/models`) — gated by the same
 * remote/allowRemote rule as a real dispatch ("a test ping is still a
 * dispatch"), so it refuses before touching fetch exactly like
 * dispatchModelTurn does.
 */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  const gate = canTestConnection();
  if (!gate.ok) return { ok: false, detail: gate.reason };

  const config = load();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${v1Base(config.endpointUrl)}/models`, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok
      ? { ok: true, detail: `Reachable — HTTP ${res.status}` }
      : { ok: false, detail: `Endpoint responded HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `Failed — ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------- model action parsing ------------------------ */

export type ParsedModelAction =
  | { action: "create_task"; title: string }
  | { action: "create_note"; title: string; body?: string }
  | { action: "set_reminder"; text: string; when: string };

const FENCE_RE = /```json\s*([\s\S]*?)```/gi;

function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

/**
 * Extract and strictly validate a single model-proposed action. A model
 * reply is untrusted input: anything outside the allowlisted shape — an
 * unknown action, an extra key, a wrong type, an oversized string, or more
 * than one fenced block — is refused (null), never partially accepted.
 */
export function parseModelAction(text: string): ParsedModelAction | null {
  const matches = [...text.matchAll(FENCE_RE)];
  let jsonText: string;
  if (matches.length === 1) {
    jsonText = matches[0][1];
  } else if (matches.length === 0) {
    jsonText = text.trim();
  } else {
    return null; // more than one fenced block — ambiguous, refuse
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  const onlyKeys = (allowed: string[]) => keys.every((k) => allowed.includes(k));

  switch (obj.action) {
    case "create_task": {
      if (!onlyKeys(["action", "title"])) return null;
      if (!isNonEmptyString(obj.title, 200)) return null;
      return { action: "create_task", title: obj.title };
    }
    case "create_note": {
      if (!onlyKeys(["action", "title", "body"])) return null;
      if (!isNonEmptyString(obj.title, 200)) return null;
      if (obj.body !== undefined && !isNonEmptyString(obj.body, 4000)) return null;
      return { action: "create_note", title: obj.title, body: obj.body as string | undefined };
    }
    case "set_reminder": {
      if (!onlyKeys(["action", "text", "when"])) return null;
      if (!isNonEmptyString(obj.text, 200)) return null;
      if (!isNonEmptyString(obj.when, 200)) return null;
      return { action: "set_reminder", text: obj.text, when: obj.when };
    }
    default:
      return null;
  }
}
