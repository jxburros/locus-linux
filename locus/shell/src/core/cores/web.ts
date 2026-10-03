/*
 * Web Core — web capability as a shared OS service (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: web apps, PWAs, URLs, embedded web surfaces, web permissions,
 * session behavior, downloads, and page metadata. A dashboard widget, a
 * monitor watch, an app shortcut, or a generated tool all use this one
 * governed web layer — never an ungoverned scraper or hidden browser for AI.
 *
 * URLs are validated, not massaged: normalizeUrl parses and returns null for
 * anything that is not http(s) — "hello world" gets an inline error, and
 * javascript: is rejected by the allowlist, not by accident. Saved apps
 * de-duplicate by normalized URL.
 *
 * v1 honesty: no embedded engine ships in a PWA, so "open" means a new
 * browser tab (always on explicit user action, always audited). Page-context
 * requests are proposal-gated; on approval the executor really fetches the
 * page — and where cross-origin rules block reading it, the stored context
 * says exactly that instead of pretending.
 */

import { storage, StoreKeys } from "../storage";
import { record } from "../audit";
import { emit } from "../events";
import { registerExternalExecutor, type ExecutorOutcome } from "../broker";
import { proposeThroughCore } from "./ai";
import { createWatch, type Watch } from "./monitor";
import { redactText } from "./secrets";
import type { ActionProposal } from "@/types";

export type WebAppKind = "pwa" | "web-app" | "site";

export interface WebApp {
  id: string;
  name: string;
  url: string;
  kind: WebAppKind;
  addedAt: number;
  lastOpenedAt?: number;
  /** How many times it has been opened (opens history, lightweight). */
  openCount?: number;
}

let seq = 0;
function makeId(): string {
  seq += 1;
  return `wa-${Date.now().toString(36)}-${seq.toString(36)}`;
}

let cache: WebApp[] | null = null;

function load(): WebApp[] {
  if (cache === null) cache = storage.get<WebApp[]>(StoreKeys.webApps, []);
  return cache;
}

function save(next: WebApp[]): void {
  cache = next;
  storage.set(StoreKeys.webApps, next);
}

export function listWebApps(): WebApp[] {
  return load();
}

export function subscribeWebApps(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.webApps, () => {
    cache = storage.get<WebApp[]>(StoreKeys.webApps, []);
    fn();
  });
}

/**
 * Parse and validate a URL. Returns the normalized form, or null when the
 * input is not a usable http(s) URL. Schemes are allowlisted — http and
 * https only, so javascript:, data:, file: are rejected by rule.
 */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Is this hostname a private, loopback, or link-local destination? Used to keep
 * an AI-initiated fetch from reaching the local network or metadata endpoints
 * (a browser-side SSRF guard). Navigation (openUrl) is deliberately NOT subject
 * to this — a user may open http://localhost themselves.
 */
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Exported so other Core modules (e.g. modelRuntime) can classify a
    user-configured endpoint as local vs remote using the same SSRF-safe
    private-host rules, instead of re-implementing host classification. */
export function isPrivateHost(host: string): boolean {
  const raw = host.toLowerCase();
  // An IPv6 literal contains a colon; a bracketed literal came in as "[...]".
  const isIpv6 = raw.includes(":");
  const h = raw.replace(/^\[|\]$/g, "");
  // Explicit local names apply to any host form.
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost")) return true;
  if (isIpv6) {
    if (h === "::1") return true;
    // ULA (fc00::/7) and link-local (fe80::/10) — ONLY for real IPv6 literals,
    // so a public domain like "fcc.gov"/"fda.gov" is not misread as private.
    if (/^f[cd]/.test(h) || h.startsWith("fe80")) return true;
    // IPv4-mapped/embedded, e.g. ::ffff:169.254.169.254 (cloud metadata).
    const tail = h.split(":").pop() ?? "";
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tail)) return isPrivateIPv4(tail);
    return false;
  }
  // IPv4 literal (a plain hostname falls through as public).
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h);
  return false;
}

/**
 * The stricter normalizer for an AI-initiated fetch (as opposed to navigation):
 * https only, no URL userinfo (a token in `user:pass@` must never be sent), and
 * no private/loopback/link-local destinations. Returns null to refuse.
 */
export function normalizeFetchUrl(raw: string): string | null {
  const normalized = normalizeUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.username || url.password) return null; // never carry credentials
  if (url.protocol !== "https:") return null; // no cleartext AI fetch
  if (isPrivateHost(url.hostname)) return null; // SSRF guard
  return url.href;
}

/** Canonical key for de-duplication: normalized URL without trailing slash. */
function urlKey(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Save a web app. Invalid URLs return null (show the user an inline error);
 * an app with the same normalized URL already saved is returned instead of
 * duplicated. Only valid saves are audited.
 */
export function addWebApp(input: { name: string; url: string; kind?: WebAppKind }): WebApp | null {
  const url = normalizeUrl(input.url);
  if (!url) return null;
  const existing = load().find((a) => urlKey(a.url) === urlKey(url));
  if (existing) return existing;
  const app: WebApp = {
    id: makeId(),
    name: input.name.trim() || new URL(url).hostname,
    url,
    kind: input.kind ?? "web-app",
    addedAt: Date.now(),
  };
  save([app, ...load()]);
  record({
    type: "webapp.added",
    summary: `Web Core: added ${app.kind} — ${app.name}`,
    skipEmit: true, // the typed bus event below carries the WebApp
  });
  emit("webapp.added", app);
  return app;
}

export function removeWebApp(id: string): void {
  const app = load().find((a) => a.id === id);
  save(load().filter((a) => a.id !== id));
  if (app) record({ type: "webapp.removed", summary: `Web Core: removed ${app.name}` });
}

/** Open a saved web app — a user action, in a new tab, audited. */
export function openWebApp(id: string): void {
  const app = load().find((a) => a.id === id);
  if (!app) return;
  save(
    load().map((a) =>
      a.id === id ? { ...a, lastOpenedAt: Date.now(), openCount: (a.openCount ?? 0) + 1 } : a,
    ),
  );
  record({ type: "webapp.opened", summary: `Web Core: opened ${app.name}`, skipEmit: true });
  emit("webapp.opened", app);
  window.open(app.url, "_blank", "noopener,noreferrer");
}

/** Open a raw URL (the Browser app's address bar). Returns false on an
    invalid URL so the surface can show an error instead of doing nothing. */
export function openUrl(raw: string): boolean {
  const url = normalizeUrl(raw);
  if (!url) return false;
  record({ type: "webapp.opened", summary: `Web Core: opened ${url}` });
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/* ------------------------------ page context -------------------------------- */

/** A captured, redaction-passed page-context record AI context can cite. */
export interface PageContext {
  id: string;
  url: string;
  capturedAt: number;
  /** True when the page could actually be read (same-origin or CORS-open). */
  readable: boolean;
  title?: string;
  description?: string;
  note: string;
}

let contextCache: PageContext[] | null = null;

function loadContexts(): PageContext[] {
  if (contextCache === null)
    contextCache = storage.get<PageContext[]>(StoreKeys.webPageContexts, []);
  return contextCache;
}
function saveContexts(next: PageContext[]): void {
  contextCache = next.slice(0, 30);
  storage.set(StoreKeys.webPageContexts, contextCache);
}

export function listPageContexts(): PageContext[] {
  return loadContexts();
}

export function subscribePageContexts(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.webPageContexts, () => {
    contextCache = storage.get<PageContext[]>(StoreKeys.webPageContexts, []);
    fn();
  });
}

/**
 * Permissioned page context: the AI asks to read a page's metadata for a
 * purpose. No fetch happens now — the request becomes an ActionProposal;
 * approval runs the capture executor (initWebCore), which fetches the page
 * and stores a redacted PageContext — or an honest "blocked by CORS" record.
 */
export async function requestPageContext(
  webAppId: string,
  purpose: string,
): Promise<ActionProposal | null> {
  const app = load().find((a) => a.id === webAppId);
  if (!app) return null;
  record({
    type: "web.pageContext.requested",
    summary: `Web Core: page context requested for ${app.name}`,
    detail: `Purpose: ${purpose}`,
  });
  // Through AI Core (verified originCore), never straight to the Broker.
  return proposeThroughCore("web", {
    app: "web",
    actionType: "web.pageContext",
    summary: `Read page context from ${app.name}`,
    detail: `Purpose: ${purpose}. Grants metadata about ${app.url} — never a hidden browsing session.`,
    effect: {
      kind: "external",
      externalSummary: `Permissioned page context for ${app.url}`,
      readOnly: true,
      targetId: app.id,
    },
  });
}

/** Fetch + extract title/meta where the web allows it; record honestly when
    it does not. Runs only from an approved proposal. */
const MAX_PAGE_BYTES = 2_000_000; // cap the body we read (metadata is small)

async function capturePageContext(rawUrl: string): Promise<PageContext> {
  // Re-validate against the strict AI-fetch policy at capture time — the app's
  // stored URL might be http, private, or carry userinfo.
  const url = normalizeFetchUrl(rawUrl);
  const base: Omit<PageContext, "readable" | "note"> = {
    id: `pc-${Date.now().toString(36)}`,
    url: url ?? rawUrl,
    capturedAt: Date.now(),
  };
  if (!url) {
    return {
      ...base,
      readable: false,
      note: "Refused — not an https page, or a private/credentialed URL (AI fetch policy)",
    };
  }
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      // Never send cookies/credentials, a referrer, or cache — an AI read must
      // not act as the logged-in user or leak where the request came from.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "follow",
    });
    window.clearTimeout(timer);
    // A redirect may have landed on a private host — re-check the final URL.
    if (res.url && isPrivateHost(new URL(res.url).hostname)) {
      return { ...base, readable: false, note: "Refused — redirected to a private destination" };
    }
    if (!res.ok) {
      return { ...base, readable: false, note: `The page answered ${res.status}` };
    }
    // Only parse HTML — never treat an image/binary/JSON body as a page.
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ...base, readable: false, note: `Not an HTML page (${contentType || "unknown type"})` };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared && declared > MAX_PAGE_BYTES) {
      return { ...base, readable: false, note: "Page is too large to read for metadata" };
    }
    const html = (await res.text()).slice(0, MAX_PAGE_BYTES);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = doc.querySelector("title")?.textContent?.trim();
    const description =
      doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ??
      doc.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ??
      undefined;
    return {
      ...base,
      readable: true,
      title: title ? redactText(title).slice(0, 200) : undefined,
      description: description ? redactText(description).slice(0, 400) : undefined,
      note: "Captured title and description metadata",
    };
  } catch {
    return {
      ...base,
      readable: false,
      note: "Unreadable from this browser (cross-origin rules block it) — no hidden fetch path exists",
    };
  }
}

let started = false;

/** Boot: register the executor that fulfills approved page-context grants. */
export function initWebCore(): void {
  if (started) return;
  started = true;
  registerExternalExecutor("web.pageContext", async (proposal): Promise<ExecutorOutcome> => {
    const app = load().find((a) => a.id === proposal.effect.targetId);
    if (!app) {
      return { status: "failed", detail: "The web app no longer exists — nothing captured." };
    }
    // Awaited: the Broker marks the proposal `executing` until this settles, so
    // it never reports a capture as done before the fetch actually finishes.
    const ctx = await capturePageContext(app.url);
    saveContexts([ctx, ...loadContexts()]);
    record({
      type: "web.pageContext.captured",
      summary: `Web Core: page context ${ctx.readable ? "captured" : "not readable"} — ${app.name}`,
      detail: ctx.readable ? `${ctx.title ?? "(no title)"}` : ctx.note,
      skipEmit: true, // the typed bus event below carries the PageContext
    });
    emit("web.pageContext.captured", ctx);
    return {
      status: ctx.readable ? "succeeded" : "partial",
      resultId: ctx.id,
      detail: ctx.readable ? ctx.title ?? "(no title)" : ctx.note,
    };
  });
}

/**
 * A watch over a web resource — created in Monitor Core (the owner of
 * conditions), sourced from this Core's shortcut model. Reachability
 * checking is opt-in (checkEnabled), honestly labeled.
 */
export function createPageWatch(webAppId: string, name?: string): Watch | null {
  const app = load().find((a) => a.id === webAppId);
  if (!app) return null;
  return createWatch({
    name: name ?? `Changes to ${app.name}`,
    type: "webpage",
    params: { url: app.url, checkEnabled: true },
    frequencyMs: 5 * 60_000,
    createdBy: "web-core",
  });
}

/** Common PWAs the directive names — one-tap starters. */
export const SUGGESTED_PWAS: { name: string; url: string }[] = [
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "Google Docs", url: "https://docs.google.com" },
  { name: "YouTube", url: "https://youtube.com" },
  { name: "Spotify", url: "https://open.spotify.com" },
  { name: "Discord", url: "https://discord.com/app" },
  { name: "Figma", url: "https://figma.com" },
  { name: "Notion", url: "https://notion.so" },
];
