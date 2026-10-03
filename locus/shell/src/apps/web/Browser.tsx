/*
 * Browser — the surface over Web Core (directive §12).
 * A URL bar, saved web apps / PWAs as first-class shortcuts, and one-tap
 * starters for the common PWAs. URLs are validated by the Core — garbage
 * shows an inline error instead of crashing or opening nothing. Per app:
 * "Watch" creates a Monitor Core reachability watch, "Page context" files a
 * proposal-gated metadata capture (the governed way AI reads a page).
 * v1 honesty: with no embedded engine, opening navigates a new tab
 * (explicit user action, audited).
 */

import { useState, useSyncExternalStore } from "react";
import {
  listWebApps,
  subscribeWebApps,
  addWebApp,
  removeWebApp,
  openWebApp,
  openUrl,
  normalizeUrl,
  createPageWatch,
  requestPageContext,
  listPageContexts,
  subscribePageContexts,
  SUGGESTED_PWAS,
} from "@/core/cores/web";
import { listWatches } from "@/core/cores/monitor";
import { formatDateTime } from "@/core/cores/time";
import { Section, FutureNote, EmptyState } from "@/components/ui";
import "./browser.css";

export default function Browser() {
  useSyncExternalStore(subscribeWebApps, listWebApps);
  useSyncExternalStore(subscribePageContexts, listPageContexts);
  const apps = listWebApps();
  const contexts = listPageContexts().slice(0, 4);
  const [url, setUrl] = useState("");
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const existingUrls = new Set(apps.map((a) => a.url.replace(/\/$/, "")));
  const watchedUrls = new Set(
    listWatches()
      .filter((w) => w.type === "webpage" && w.params.url)
      .map((w) => w.params.url!.replace(/\/$/, "")),
  );

  function go(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!url.trim()) return;
    if (!openUrl(url)) {
      setError(`“${url}” is not a usable http(s) URL.`);
    }
  }

  function save() {
    setError("");
    const app = addWebApp({ name: saveName || url, url });
    if (!app) {
      setError(`“${url}” is not a usable http(s) URL.`);
      return;
    }
    setSaveName("");
    setNotice(`Saved ${app.name}.`);
  }

  return (
    <div className="browser">
      <form className="browser__bar" onSubmit={go}>
        <span className="mono faint" aria-hidden>◍</span>
        <input
          className="field browser__url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
            setNotice("");
          }}
          placeholder="Enter a URL — opens in a new tab (no embedded engine yet)"
          aria-label="URL"
        />
        <button className="btn btn--primary" type="submit">Open</button>
        <input
          className="field browser__name"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name to save as…"
          aria-label="Name to save this URL as a web app"
        />
        <button className="btn" type="button" disabled={!normalizeUrl(url)} onClick={save}>
          Save as web app
        </button>
      </form>
      {error && <p className="browser__error mono">{error}</p>}
      {notice && !error && <p className="faint mono browser__notice">{notice}</p>}

      <Section title="Your web apps">
        {apps.length === 0 ? (
          <EmptyState
            title="No web apps saved"
            hint="Saved web apps are first-class shortcuts: they open from here, the command palette, and (later) as installed PWAs."
          />
        ) : (
          <ul className="browser__grid">
            {apps.map((a) => (
              <li key={a.id} className="browser__app">
                <button className="browser__open" onClick={() => openWebApp(a.id)} title={a.url}>
                  <span className="browser__appname">{a.name}</span>
                  <span className="mono faint browser__appurl">{a.url.replace(/^https?:\/\//, "")}</span>
                  {a.lastOpenedAt && (
                    <span className="mono faint browser__appused">
                      opened {formatDateTime(a.lastOpenedAt)}
                      {a.openCount && a.openCount > 1 ? ` · ${a.openCount}×` : ""}
                    </span>
                  )}
                </button>
                <span className="browser__appactions">
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={watchedUrls.has(a.url.replace(/\/$/, ""))}
                    onClick={() => {
                      createPageWatch(a.id);
                      setNotice(`Monitor is watching ${a.name} for reachability.`);
                    }}
                    title="Create a Monitor Core reachability watch for this page"
                  >
                    {watchedUrls.has(a.url.replace(/\/$/, "")) ? "Watching" : "Watch"}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      requestPageContext(a.id, "user asked from the Browser");
                      setNotice("Page-context request filed — approve it in AI Assistant → Approvals.");
                    }}
                    title="Proposal-gated: on approval, the page's title/description metadata is captured (redacted) for AI context"
                  >
                    Page context
                  </button>
                  <button className="browser__x" onClick={() => removeWebApp(a.id)} aria-label={`Remove ${a.name}`}>✕</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {contexts.length > 0 && (
        <Section title="Captured page context">
          <ul className="browser__contexts">
            {contexts.map((c) => (
              <li key={c.id} className="browser__context">
                <span className="mono faint">{c.url.replace(/^https?:\/\//, "")}</span>
                <span>
                  {c.readable ? (
                    <>
                      <strong>{c.title ?? "(no title)"}</strong>
                      {c.description && <span className="faint"> — {c.description}</span>}
                    </>
                  ) : (
                    <span className="faint">{c.note}</span>
                  )}
                </span>
                <span className="mono faint">{formatDateTime(c.capturedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Common PWAs">
        <ul className="browser__suggest">
          {SUGGESTED_PWAS.filter((s) => !existingUrls.has(s.url.replace(/\/$/, ""))).map((s) => (
            <li key={s.url}>
              <button className="chip browser__chip" onClick={() => addWebApp({ name: s.name, url: s.url, kind: "pwa" })}>
                + {s.name}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="About this app">
        <FutureNote
          items={[
            "Embedded engine strategy: Chromium-based for compatibility, Servo for OS-native web surfaces",
            "Real PWA install, downloads, history, and per-site permissions",
            "Viewer/Screen web rendering once an engine exists",
          ]}
        />
      </Section>
    </div>
  );
}
