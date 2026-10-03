/*
 * Connected Sources — scopes and indexing.
 * ---------------------------------------------------------------------------
 * Where Locus may read and index. Each source carries two independent switches
 * (readable / indexable) plus exclusions, and shows its last-indexed time. An
 * index pass can be run on demand; the overall index status summarizes how much
 * of your local data currently has a metadata summary.
 */

import { useState, useSyncExternalStore } from "react";
import {
  getSources,
  setReadable,
  setIndexable,
  addExclusion,
  removeExclusion,
  subscribe as subscribeSources,
} from "@/core/sources";
import { runIndex, indexStatus } from "@/core/indexing";
import { allObjects, subscribe as subscribeObjects } from "@/core/objects";
import { Section, FutureNote } from "@/components/ui";
import type { ConnectedSource } from "@/core/sources";
import "./sources.css";

function useSources(): ConnectedSource[] {
  return useSyncExternalStore(subscribeSources, getSources);
}

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Sources() {
  const sources = useSources();
  // Re-render index status when objects change (index states move).
  useSyncExternalStore(subscribeObjects, allObjects);
  const status = indexStatus();

  return (
    <div className="sources">
      <div className="sources__status panel">
        <div className="sources__status-grid">
          <Stat label="Objects" value={status.total} />
          <Stat label="Indexed" value={status.indexed} accent />
          <Stat label="Stale" value={status.stale} />
          <Stat label="Excluded" value={status.excluded} />
          <Stat label="Unindexed" value={status.unindexed} />
        </div>
        <div className="sources__status-foot">
          <span className="faint mono">Last pass: {timeAgo(status.lastRun)}</span>
          <button className="btn btn--sm" onClick={() => runIndex()}>
            Index all now
          </button>
        </div>
      </div>

      <Section title="Connected sources">
        <ul className="sources__list">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
        </ul>
      </Section>

      <FutureNote
        items={[
          "Real folder connection via the File System Access API",
          "Scheduled background indexing with a rate budget",
          "Per-source metadata summaries surfaced to search and the assistant",
        ]}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="sources__stat">
      <span className={`sources__stat-value mono ${accent ? "sources__stat-value--accent" : ""}`}>
        {value}
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function SourceRow({ source }: { source: ConnectedSource }) {
  const [excl, setExcl] = useState("");

  return (
    <li className="sources__source panel">
      <div className="sources__source-head">
        <div>
          <span className="sources__source-name">{source.name}</span>
          <span className="chip mono sources__source-kind">{source.kind}</span>
        </div>
        <span className="faint mono sources__source-indexed">
          indexed {timeAgo(source.lastIndexed)}
        </span>
      </div>
      {source.detail && <p className="faint sources__source-detail">{source.detail}</p>}

      <div className="sources__toggles">
        <label className="sources__toggle">
          <input
            type="checkbox"
            checked={source.readable}
            onChange={(e) => setReadable(source.id, e.target.checked)}
          />
          <span>Readable</span>
          <span className="faint">The AI may see items in this source.</span>
        </label>
        <label className="sources__toggle">
          <input
            type="checkbox"
            checked={source.indexable}
            onChange={(e) => setIndexable(source.id, e.target.checked)}
          />
          <span>Indexable</span>
          <span className="faint">Build metadata summaries over this source.</span>
        </label>
      </div>

      <div className="sources__exclusions">
        <span className="eyebrow">Exclusions</span>
        <div className="sources__excl-chips">
          {source.exclusions.length ? (
            source.exclusions.map((e) => (
              <button
                key={e}
                className="chip sources__excl"
                onClick={() => removeExclusion(source.id, e)}
                title="Remove exclusion"
              >
                {e} ✕
              </button>
            ))
          ) : (
            <span className="faint mono">none</span>
          )}
        </div>
        <div className="sources__excl-add">
          <input
            className="field"
            value={excl}
            onChange={(e) => setExcl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addExclusion(source.id, excl);
                setExcl("");
              }
            }}
            placeholder="Add a path/pattern to exclude…"
            aria-label={`Add exclusion to ${source.name}`}
          />
        </div>
      </div>

      <div className="sources__source-actions">
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => runIndex(source.id)}
          disabled={!source.indexable}
          title={source.indexable ? "" : "Enable indexing first"}
        >
          Index this source
        </button>
      </div>
    </li>
  );
}
