/*
 * Search — one query across everything you own, through Search / Index Core.
 * The app is a thin surface over searchAll(): the same path the assistant
 * uses, so exclusions and redaction hold everywhere — an `excluded` object
 * never appears here, trashed files stay in the trash, and snippets (and
 * titles) pass the Secrets Core redaction pass. The filter grammar
 * (type: tag: before: after:) renders as removable chips.
 */

import { useMemo, useState } from "react";
import { searchAll, parseQuery, safeSnippet } from "@/core/cores/searchIndex";
import { useObjects } from "@/core/hooks";
import { useShell } from "@/core/shell";
import { Section, FutureNote } from "@/components/ui";
import { OBJECT_TYPE_META } from "@/types";
import type { AppId, ObjectType } from "@/types";
import "./search.css";

const APP_FOR_TYPE: Record<ObjectType, AppId> = {
  document: "writer",
  card: "cards",
  task: "tasks",
  project: "projects",
  file: "files",
  memory: "assistant",
};

const EXAMPLE_FILTERS = ["type:task", "type:card tag:core", "after:2026-01-01"];

export default function Search() {
  const { openApp } = useShell();
  // Subscribe so results refresh live as objects change.
  useObjects();
  const [q, setQ] = useState("");
  const query = q.trim();

  const parsed = useMemo(() => parseQuery(query), [query]);
  const result = useMemo(() => searchAll(query), [query]);
  const hasQuery = !!query;

  const byType = useMemo(() => {
    const groups = new Map<ObjectType, typeof result.objects>();
    for (const hit of result.objects) {
      const list = groups.get(hit.object.type) ?? [];
      list.push(hit);
      groups.set(hit.object.type, list);
    }
    return groups;
  }, [result.objects]);

  const total = result.objects.length + result.apps.length + result.contacts.length;

  const activeChips: { label: string; strip: string }[] = [];
  if (parsed.type) activeChips.push({ label: `type:${parsed.type}`, strip: `type:${parsed.type}` });
  if (parsed.tag) activeChips.push({ label: `tag:${parsed.tag}`, strip: `tag:${parsed.tag}` });
  if (parsed.before) activeChips.push({ label: `before:${parsed.before}`, strip: `before:${parsed.before}` });
  if (parsed.after) activeChips.push({ label: `after:${parsed.after}`, strip: `after:${parsed.after}` });

  function removeChip(strip: string) {
    setQ(
      q
        .replace(new RegExp(`${strip.split(":")[0]}:\\s*${strip.split(":")[1]}`, "i"), "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return (
    <div className="search">
      <input
        className="field search__input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search everything you own… (type:task tag:core before:2026-08-01)"
        aria-label="Search everything"
        autoFocus
      />

      {(activeChips.length > 0 || result.errors.length > 0) && (
        <div className="search__chips">
          {activeChips.map((c) => (
            <button
              key={c.label}
              className="chip search__chip"
              onClick={() => removeChip(c.strip)}
              title="Remove filter"
            >
              {c.label} ✕
            </button>
          ))}
          {result.errors.map((e) => (
            <span key={e} className="search__error mono">{e}</span>
          ))}
        </div>
      )}

      {hasQuery && (
        <p className="faint mono search__count">
          {total} result{total === 1 ? "" : "s"} for “{q}”
        </p>
      )}

      {!hasQuery && (
        <>
          <p className="muted search__hint">
            Type to search across your documents, cards, tasks, projects, files, memory, contacts,
            and apps — one index, exclusions respected, secrets redacted.
          </p>
          <div className="search__chips">
            {EXAMPLE_FILTERS.map((f) => (
              <button key={f} className="chip search__chip" onClick={() => setQ(`${f} `)}>
                {f}
              </button>
            ))}
          </div>
        </>
      )}

      {result.apps.length > 0 && (
        <Section title={`Apps · ${result.apps.length}`}>
          <ul className="search__apps">
            {result.apps.map((a) => (
              <li key={a.id}>
                <button className="search__app" onClick={() => openApp(a.id)}>
                  <span className="search__app-icon mono" aria-hidden>{a.icon}</span>
                  <span>
                    <span className="search__app-name">{a.name}</span>
                    <span className="muted search__app-desc">{a.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result.contacts.length > 0 && (
        <Section title={`Contacts · ${result.contacts.length}`}>
          <ul className="search__apps">
            {result.contacts.map((c) => (
              <li key={c.id}>
                <button className="search__app" onClick={() => openApp("people")}>
                  <span className="search__app-icon mono" aria-hidden>◉</span>
                  <span>
                    <span className="search__app-name">{c.name}</span>
                    <span className="muted search__app-desc">{c.category}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {[...byType.entries()].map(([type, hits]) => (
        <Section key={type} title={`${OBJECT_TYPE_META[type].plural} · ${hits.length}`}>
          <ul className="search__results">
            {hits.map(({ object, field }) => (
              <li key={object.id}>
                <button
                  className="search__result"
                  onClick={() => openApp(APP_FOR_TYPE[type])}
                >
                  <span className="mono faint search__result-kind" aria-hidden>
                    {OBJECT_TYPE_META[type].glyph}
                  </span>
                  <span className="search__result-body">
                    <span className="search__result-title">
                      {safeSnippet(object.title || "Untitled", 80)}
                    </span>
                    {field === "body" && object.body && (
                      <span className="muted search__result-snippet">
                        {safeSnippet(object.body)}
                      </span>
                    )}
                    {field === "tag" && (
                      <span className="muted search__result-snippet">
                        matched tag:{" "}
                        {object.tags.find((t) =>
                          t.toLowerCase().includes(parsed.text.toLowerCase()),
                        ) ?? object.tags[0]}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {hasQuery && total === 0 && result.errors.length === 0 && (
        <p className="faint search__empty">Nothing matches “{q}”.</p>
      )}

      <FutureNote
        items={[
          "Semantic and natural-language search, on-device",
          "Saved searches and smart collections",
          "Due-date and source filters",
        ]}
      />
    </div>
  );
}
