/*
 * AI Assistant — the system-level collaborator.
 * ---------------------------------------------------------------------------
 * Four honest surfaces onto the trust model:
 *  · Ask      — a local rule-based turn that either answers (read) or produces
 *               a proposal (write). No data changes without your approval.
 *  · Context  — the inspector: exactly what the assistant may read right now.
 *  · Approvals— the broker's queue of proposed changes, approve or decline.
 *  · Memory   — the user/project/app memory the assistant may consult.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { useShell } from "@/core/shell";
import { useObjectsOfType } from "@/core/hooks";
import { buildContextPacket, logContextRead, packetObjectTitles } from "@/core/aiContext";
import { interpretAsync, type AssistantTurn } from "@/core/assistant";
import {
  getProposals,
  pendingProposals,
  approve,
  deny,
  undoProposal,
  clearResolvedProposals,
  subscribe as subscribeBroker,
} from "@/core/broker";
import { buildApprovalPrompt } from "@/core/cores/security";
import { diffLines } from "@/core/cores/editor";
import { createObject, updateObject, trashObject, getObject } from "@/core/objects";
import { getApp } from "@/core/appRegistry";
import { getCore } from "@/core/cores/registry";
import type { ActionProposal, AppId, MemoryScope } from "@/types";
import { Section } from "@/components/ui";
import "./assistant.css";

type Tab = "ask" | "context" | "approvals" | "memory";

function useBroker() {
  return useSyncExternalStore(subscribeBroker, getProposals);
}

export default function Assistant() {
  const [tab, setTab] = useState<Tab>("ask");
  const proposals = useBroker();
  const pendingCount = proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="assistant">
      <nav className="assistant__tabs" role="tablist" aria-label="Assistant sections">
        {(
          [
            ["ask", "Ask"],
            ["context", "Context"],
            ["approvals", `Approvals${pendingCount ? ` · ${pendingCount}` : ""}`],
            ["memory", "Memory"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`assistant__tab ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "ask" && <Ask />}
      {tab === "context" && <ContextInspector />}
      {tab === "approvals" && <Approvals />}
      {tab === "memory" && <Memory />}
    </div>
  );
}

/* --------------------------------- Ask ---------------------------------- */

function Ask() {
  const { activeApp } = useShell();
  const [input, setInput] = useState("");
  const [turn, setTurn] = useState<AssistantTurn | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const result = await interpretAsync(input, activeApp);
      setTurn(result);
      setCommitted(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="assistant__ask">
      <div className="assistant__ask-row">
        <input
          className="field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Ask, or request a change…"
          aria-label="Ask the assistant"
          disabled={busy}
        />
        <button className="btn btn--primary" onClick={run} disabled={busy}>
          {busy ? "…" : "Send"}
        </button>
      </div>

      <div className="assistant__suggest">
        {["how many tasks are open", "find local-first", "add task: review the roadmap", "what can you see"].map(
          (s) => (
            <button key={s} className="chip assistant__chip" onClick={() => setInput(s)}>
              {s}
            </button>
          ),
        )}
      </div>

      {busy && <p className="faint mono assistant__thinking">…thinking</p>}

      {turn && !busy && (
        <div className="assistant__turn panel">
          {turn.kind === "answer" ? (
            <>
              <span className="assistant__badge assistant__badge--read mono">READ</span>
              <p className="assistant__answer">{turn.text}</p>
            </>
          ) : (
            <>
              <span className="assistant__badge assistant__badge--write mono">PROPOSAL</span>
              <p className="assistant__answer">{turn.summary}</p>
              {committed ? (
                <p className="faint mono assistant__committed">
                  Queued for approval → see the Approvals tab.
                </p>
              ) : (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    turn.commit();
                    setCommitted(true);
                  }}
                >
                  Propose this change
                </button>
              )}
            </>
          )}
          {turn.via && (
            <p className="faint mono assistant__via" title="AI Core's routing decision for this request">
              via: {turn.via}
            </p>
          )}
        </div>
      )}

      <p className="faint assistant__note">
        This is a local rule-based assistant. Reads are answered immediately; anything that
        changes data becomes a proposal you approve in the broker.
      </p>
    </div>
  );
}

/* ----------------------------- Context ---------------------------------- */

function ContextInspector() {
  const { activeApp } = useShell();
  // Rebuild whenever anything the packet depends on changes.
  useObjectsOfType("memory");
  const packet = useMemo(() => buildContextPacket(activeApp), [activeApp]);
  const titles = packetObjectTitles(packet);

  return (
    <div className="assistant__context">
      <div className="assistant__summary panel">
        <p>{packet.userVisibilitySummary}</p>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => logContextRead(packet)}
        >
          Log a context read
        </button>
      </div>

      <Section title={`In scope · ${packet.scopedApps.length} apps`}>
        <div className="assistant__scope">
          {packet.scopedApps.length ? (
            packet.scopedApps.map((id: AppId) => (
              <span key={id} className="chip">{getApp(id)?.name ?? id}</span>
            ))
          ) : (
            <span className="faint">No apps in this workspace's AI scope.</span>
          )}
        </div>
      </Section>

      <Section title={`Readable context · ${packet.readableCapabilities.length}`}>
        <ul className="assistant__caps">
          {packet.readableCapabilities.map((c, i) => (
            <li key={`${c.app}-${i}`} className="assistant__cap">
              <span className="mono faint assistant__cap-app">{getApp(c.app)?.icon}</span>
              <span>{c.label}</span>
              {c.objectIds.length > 0 && (
                <span className="chip mono">{c.objectIds.length}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {titles.length > 0 && (
        <Section title="Objects the AI could surface">
          <div className="assistant__scope">
            {titles.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
        </Section>
      )}

      {packet.coreSummaries.length > 0 && (
        <Section title="Core context (what the Cores would tell the AI)">
          <ul className="assistant__caps">
            {packet.coreSummaries.map((cs) => (
              <li key={cs.core} className="assistant__cap assistant__cap--core">
                <span className="mono faint assistant__cap-app">{getCore(cs.core as never)?.icon ?? "◌"}</span>
                <span className="assistant__corelines">
                  {cs.lines.map((l, i) => (
                    <span key={i} className="assistant__coreline">{l}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Connected sources · ${packet.retrievedSources.length}`}>
        <div className="assistant__scope">
          {packet.retrievedSources.length ? (
            packet.retrievedSources.map((s) => <span key={s} className="chip">{s}</span>)
          ) : (
            <span className="faint">No readable sources.</span>
          )}
        </div>
      </Section>
    </div>
  );
}

/* ---------------------------- Approvals --------------------------------- */

/** The Editor Core line diff for update proposals that rewrite a body —
    the mandate made visible: you see exactly what would change. */
function ProposalDiff({ proposal }: { proposal: ActionProposal }) {
  const diff = useMemo(() => {
    if (proposal.effect.kind !== "update" || proposal.effect.payload?.body === undefined) {
      return null;
    }
    const target = proposal.effect.targetId ? getObject(proposal.effect.targetId) : undefined;
    if (!target) return null;
    return diffLines(target.body ?? "", proposal.effect.payload.body).filter(
      (l) => l.kind !== "same",
    );
  }, [proposal]);
  const stale =
    proposal.effect.baseUpdatedAt !== undefined &&
    proposal.effect.targetId !== undefined &&
    getObject(proposal.effect.targetId)?.updatedAt !== proposal.effect.baseUpdatedAt;

  if (!diff) return null;
  return (
    <div className="assistant__diff mono">
      {stale && (
        <p className="assistant__stale">
          The document changed after this was proposed — approving will fail; re-propose instead.
        </p>
      )}
      {diff.length === 0 ? (
        <span className="faint">No line changes.</span>
      ) : (
        diff.slice(0, 12).map((l, i) => (
          <span key={i} className={`assistant__diffline assistant__diffline--${l.kind}`}>
            {l.kind === "added" ? "+ " : "− "}
            {l.text || " "}
          </span>
        ))
      )}
      {diff.length > 12 && <span className="faint">…{diff.length - 12} more changed lines</span>}
    </div>
  );
}

function Approvals() {
  const proposals = useBroker();
  const pending = pendingProposals();
  const resolved = proposals.filter((p) => p.status !== "pending").slice(0, 8);

  return (
    <div className="assistant__approvals">
      <Section title={`Awaiting your decision · ${pending.length}`}>
        {pending.length ? (
          <ul className="assistant__queue">
            {pending.map((p) => {
              const prompt = buildApprovalPrompt(p);
              return (
                <li key={p.id} className="assistant__proposal panel">
                  <div className="assistant__proposal-head">
                    <span className={`assistant__badge assistant__badge--write mono`}>
                      {p.effect.kind}
                    </span>
                    <span className="assistant__proposal-summary">{p.summary}</span>
                    <span className={`assistant__risk assistant__risk--${prompt.risk} mono`}>
                      {prompt.risk}
                    </span>
                  </div>
                  {p.detail && <p className="faint assistant__proposal-detail">{p.detail}</p>}
                  <p className="faint mono assistant__proposal-meta">
                    {prompt.riskLabel} · {prompt.undoNote}
                  </p>
                  <ProposalDiff proposal={p} />
                  <div className="assistant__proposal-actions">
                    <button className="btn btn--primary btn--sm" onClick={() => approve(p.id)}>
                      Approve
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => deny(p.id)}>
                      Decline
                    </button>
                    <span className="chip mono assistant__proposal-app">
                      {getApp(p.app)?.name ?? p.app}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="faint">Nothing pending. Proposals from the Ask tab land here.</p>
        )}
      </Section>

      {resolved.length > 0 && (
        <Section
          title="Recently resolved"
          action={
            <button className="btn btn--ghost btn--sm" onClick={clearResolvedProposals}>
              Clear
            </button>
          }
        >
          <ul className="assistant__resolved">
            {resolved.map((p) => (
              <li key={p.id} className="assistant__resolved-item">
                <span className={`assistant__status assistant__status--${p.status} mono`}>
                  {p.undoneAt ? "undone" : p.status}
                </span>
                <span>{p.summary}</span>
                {p.status === "executed" && p.undo && !p.undoneAt && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => undoProposal(p.id)}
                    title={p.undoNote ?? "Undo from the snapshot taken at execution"}
                  >
                    Undo
                  </button>
                )}
                {p.error && <span className="faint mono"> — {p.error}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------ Memory ---------------------------------- */

const SCOPES: MemoryScope[] = ["user", "project", "app", "agent", "model"];

function Memory() {
  const memories = useObjectsOfType("memory");
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<MemoryScope>("user");

  function add() {
    const title = draft.trim();
    if (!title) return;
    createObject({ type: "memory", title, memory: { scope } });
    setDraft("");
  }

  return (
    <div className="assistant__memory">
      <p className="muted assistant__memory-intro">
        Memory is visible and editable. The assistant may consult it, but you own every line.
      </p>
      <div className="assistant__ask-row">
        <input
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a memory the assistant may use…"
          aria-label="New memory"
        />
        <select
          className="field assistant__scope-select"
          value={scope}
          onChange={(e) => setScope(e.target.value as MemoryScope)}
          aria-label="Memory scope"
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="btn btn--primary" onClick={add}>Add</button>
      </div>

      <ul className="assistant__memory-list">
        {memories.map((m) => (
          <li key={m.id} className="assistant__memory-item">
            <span className={`chip mono assistant__memory-scope`}>{m.memory?.scope}</span>
            <input
              className="assistant__memory-text"
              value={m.title}
              onChange={(e) => updateObject(m.id, { title: e.target.value })}
              aria-label="Memory text"
            />
            <button
              className="assistant__memory-del"
              onClick={() => trashObject(m.id)}
              aria-label={`Delete memory`}
              title="Moves the memory to the trash (recoverable)" 
            >
              ✕
            </button>
          </li>
        ))}
        {memories.length === 0 && <li className="faint">No memory yet.</li>}
      </ul>
    </div>
  );
}
