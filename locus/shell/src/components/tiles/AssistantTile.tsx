/*
 * AI Assistant tile.
 * ---------------------------------------------------------------------------
 * The assistant is part of the environment, not a separate chatbot destination.
 * The tile never hides what it is: assistant name (user-chosen) vs provider
 * (system engine), memory/context status, permission mode. With no model
 * assigned the OS still works — the tile shows setup status, and the local
 * rule-based interpreter still answers (spec §18: graceful degradation).
 */

import { useState, useSyncExternalStore } from "react";
import type { TileProps } from "./registry";
import { useShell } from "@/core/shell";
import { storage, StoreKeys } from "@/core/storage";
import { interpret } from "@/core/assistant";
import { getProposals, subscribe as subscribeBroker } from "@/core/broker";
import { objectsOfType, subscribe as subscribeObjects } from "@/core/objects";

export const DEFAULT_ASSISTANT_NAME = "Milo";

export function useAssistantName(): string {
  return useSyncExternalStore(
    (cb) => storage.subscribe(StoreKeys.assistantName, cb),
    () => storage.get<string>(StoreKeys.assistantName, DEFAULT_ASSISTANT_NAME),
  );
}

function useProvider(): string {
  return useSyncExternalStore(
    (cb) => storage.subscribe(StoreKeys.aiProvider, cb),
    () => storage.get<string>(StoreKeys.aiProvider, "none"),
  );
}

/** Status line per spec §18: "Milo — No model assigned", "Milo — Local model ready"… */
export function assistantStatus(name: string, provider: string): { line: string; ok: boolean } {
  switch (provider) {
    case "local":
      return { line: `${name} — Local model ready`, ok: true };
    case "cloud":
      return { line: `${name} — Cloud provider active`, ok: true };
    default:
      return { line: `${name} — No model assigned`, ok: false };
  }
}

interface MiniTurn {
  who: "you" | "ai";
  text: string;
  action?: { label: string; run: () => void };
}

export function AssistantTile({ size, live }: TileProps) {
  const { openApp, activeApp } = useShell();
  const name = useAssistantName();
  const provider = useProvider();
  const status = assistantStatus(name, provider);

  const proposals = useSyncExternalStore(subscribeBroker, getProposals);
  const pending = proposals.filter((p) => p.status === "pending").length;
  useSyncExternalStore(subscribeObjects, () => objectsOfType("memory").length);
  const memories = objectsOfType("memory").length;

  const [thread, setThread] = useState<MiniTurn[]>([]);
  const [input, setInput] = useState("");

  function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const turn = interpret(q, activeApp);
    const reply: MiniTurn =
      turn.kind === "answer"
        ? { who: "ai", text: turn.text }
        : {
            who: "ai",
            text: `Proposal: ${turn.summary}. Nothing changes until you approve it.`,
            action: { label: "Queue for approval", run: turn.commit },
          };
    setThread((t) => [...t.slice(-8), { who: "you", text: q }, reply]);
    setInput("");
  }

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="mono tilec__big" aria-hidden>◐</span>
        <span className="muted assistant__status-line">
          <span className={`dot ${status.ok ? "dot--on" : "dot--off"}`} aria-hidden /> {status.line}
        </span>
      </div>
    );
  }

  const last = thread[thread.length - 1];

  return (
    <div className="tilec assistant">
      <p className="assistant__status">
        <span className={`dot ${status.ok ? "dot--on" : "dot--off"}`} aria-hidden />
        <span className="muted">{status.line}</span>
        {pending > 0 && <span className="chip assistant__pending">{pending} awaiting approval</span>}
      </p>

      {!status.ok && size !== "small" && (
        <div className="assistant__setup">
          <p className="faint">
            No AI model assigned. Set up Ollama, a local server, or an API provider — the desktop
            works either way.
          </p>
          <button className="btn btn--sm btn--ghost" onClick={() => openApp("ai-control")}>
            Set up a provider
          </button>
        </div>
      )}

      {size !== "small" && thread.length > 0 && (
        <ul className={`assistant__thread ${!live ? "is-paused" : ""}`}>
          {thread.slice(size === "medium" ? -4 : -8).map((t, i) => (
            <li key={i} className={`assistant__turn assistant__turn--${t.who}`}>
              <span className="assistant__who mono">{t.who === "you" ? "you" : name}</span>
              <span className="assistant__text">{t.text}</span>
              {t.action && (
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    t.action!.run();
                    setThread((th) => th.map((x) => (x === t ? { ...x, action: undefined, text: `${x.text} — queued.` } : x)));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {size === "small" && last && (
        <p className="assistant__last muted">{last.who === "you" ? `You: ${last.text}` : last.text}</p>
      )}

      <form className="assistant__ask" onSubmit={ask}>
        <input
          className="field"
          placeholder={`Ask ${name}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label={`Ask ${name}`}
        />
        {size !== "small" && <button className="btn" type="submit">Ask</button>}
      </form>

      {(size === "large" || size === "medium") && (
        <p className="faint tilec__hint">
          Memory: {memories} item{memories === 1 ? "" : "s"} · local · writes are approval-gated ·{" "}
          <button className="tilec__link" onClick={() => openApp("assistant")}>
            open full assistant
          </button>
        </p>
      )}
    </div>
  );
}
