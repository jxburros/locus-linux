/*
 * Cards — the surface over Cardspoke Core's knowledge kernel.
 * Cards are real objects with editable title, body, tags, and links. The
 * kernel does the thinking: [[wiki-links]] in the body render as navigable
 * links (backlinks are computed from both explicit links and mentions),
 * related cards surface by shared tags, and a card can convert to a task or
 * document — losslessly reversible, because the previous shape is
 * snapshotted. Everything persists locally.
 */

import { Fragment, useState } from "react";
import { useObjects } from "@/core/hooks";
import {
  allCards,
  createCard,
  updateCard,
  deleteCard,
  restoreCard,
  trashedCards,
  requestCardTrashPurge,
  purgeCardTrash,
  linkCards,
  unlinkCards,
  linksFor,
  backlinksFor,
  relatedByTags,
  resolveWikiLinks,
  convertCard,
  revertConversion,
  outlineItems,
  convertOutlineToTasks,
  type CardspokeType,
} from "@/core/cores/cardspoke";
import { getObject } from "@/core/objects";
import { OBJECT_TYPE_META } from "@/types";
import type { SystemObject } from "@/types";
import { Section, FutureNote, Toolbar } from "@/components/ui";
import "./cards.css";

/** Render body text with [[wiki-links]] as navigation. Unresolved links show
    as creatable stubs. Pure display — editing stays plain text. */
function WikiBody({
  body,
  onNavigate,
  onCreate,
}: {
  body: string;
  onNavigate: (id: string) => void;
  onCreate: (title: string) => void;
}) {
  const resolved = resolveWikiLinks(body);
  if (resolved.length === 0) return <>{body}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  resolved.forEach(({ link, objectId }, i) => {
    if (link.startIndex > cursor) parts.push(body.slice(cursor, link.startIndex));
    parts.push(
      objectId ? (
        <button
          key={`wl-${i}`}
          className="cards__wikilink"
          onClick={() => onNavigate(objectId)}
          title={`Open “${link.title}”`}
        >
          {link.title}
        </button>
      ) : (
        <button
          key={`wl-${i}`}
          className="cards__wikilink cards__wikilink--missing"
          onClick={() => onCreate(link.title)}
          title={`Create “${link.title}”`}
        >
          {link.title}?
        </button>
      ),
    );
    cursor = link.endIndex;
  });
  if (cursor < body.length) parts.push(body.slice(cursor));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}

/** The recoverable trash for Cardspoke objects: restore one, or empty it with
    the Core's two-step confirmation token (arm, then confirm). */
function CardTrash() {
  useObjects(); // re-render on any object write
  const trashed = trashedCards();
  const [purgeToken, setPurgeToken] = useState<string | null>(null);
  if (trashed.length === 0) return null;
  return (
    <div className="cards__trash">
      <div className="eyebrow">Trash · {trashed.length}</div>
      <ul>
        {trashed.map((o) => (
          <li key={o.id} className="row" style={{ justifyContent: "space-between", gap: 6 }}>
            <span className="faint cards__item-title">{o.title || "Untitled"}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => restoreCard(o.id)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
      <button
        className={`btn btn--sm ${purgeToken ? "btn--primary" : "btn--ghost"}`}
        onClick={() => {
          if (!purgeToken) {
            setPurgeToken(requestCardTrashPurge().token);
            return;
          }
          purgeCardTrash(purgeToken);
          setPurgeToken(null);
        }}
        title="Permanent deletion requires this second confirming click (Core-level token)"
      >
        {purgeToken ? "Confirm empty trash" : "Empty trash…"}
      </button>
    </div>
  );
}

export default function Cards() {
  // Live view over the shared store; the kernel reads through the Core.
  useObjects();
  const cards = allCards().filter((c) => c.type === "card");
  const [selectedId, setSelectedId] = useState<string>("");
  const [editing, setEditing] = useState(false);

  const selected = cards.find((c) => c.id === selectedId) ?? cards[0];
  // Kernel queries: explicit links + [[mentions]], backlinks, related-by-tags.
  const linked = selected ? linksFor(selected.id) : [];
  const backlinks = selected ? backlinksFor(selected.id) : [];
  const related = selected ? relatedByTags(selected.id, 6) : [];

  function addCard(title = "New card") {
    const card = createCard({ type: "card", title, body: "" });
    setSelectedId(card.id);
    setEditing(true);
  }

  function open(id: string) {
    const o = getObject(id);
    if (!o) return;
    setSelectedId(id);
    setEditing(false);
  }

  function convert(to: CardspokeType) {
    if (!selected) return;
    convertCard(selected.id, to);
  }

  function outlineToTasks() {
    if (!selected) return;
    const created = convertOutlineToTasks(selected.id);
    if (created.length > 0) setSelectedId(selected.id);
  }

  function toggleLink(targetId: string) {
    if (!selected?.card) return;
    const has = selected.card.links.includes(targetId);
    // Both directions through Cardspoke Core — link state is Core-owned.
    if (has) unlinkCards(selected.id, targetId);
    else linkCards(selected.id, targetId);
  }

  return (
    <div className="cards">
      <div className="cards__list">
        <Toolbar>
          <button className="btn btn--primary btn--sm" onClick={() => addCard()}>
            + New card
          </button>
          <span className="mono faint">{cards.length} cards</span>
        </Toolbar>
        <ul>
          {cards.map((card) => (
            <li key={card.id}>
              <button
                className={`cards__item ${card.id === selected?.id ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedId(card.id);
                  setEditing(false);
                }}
              >
                <span className="cards__item-title">{card.title || "Untitled"}</span>
                {card.tags[0] && <span className="chip">{card.tags[0]}</span>}
              </button>
            </li>
          ))}
          {cards.length === 0 && <li className="faint cards__empty">No cards yet.</li>}
        </ul>
        <CardTrash />
      </div>

      <div className="cards__detail">
        {selected ? (
          <>
            <div className="cards__detail-head">
              {editing ? (
                <input
                  className="field cards__title-input"
                  value={selected.title}
                  onChange={(e) => updateCard(selected.id, { title: e.target.value })}
                  aria-label="Card title"
                  placeholder="Untitled"
                />
              ) : (
                <h2 className="cards__detail-title">{selected.title || "Untitled"}</h2>
              )}
              <div className="cards__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? "Done" : "Edit"}
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => convert("task")}
                  title="Convert to a task (reversible — Cardspoke Core keeps the previous shape)"
                >
                  → Task
                </button>
                {outlineItems(selected.body).length > 0 && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={outlineToTasks}
                    title="Create a task for each bullet/checklist line in this card's body (Cardspoke Core, idempotent)"
                  >
                    → Tasks (outline)
                  </button>
                )}
                {selected.previousShape && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => revertConversion(selected.id)}
                    title={`Revert to ${OBJECT_TYPE_META[selected.previousShape.type].label.toLowerCase()}`}
                  >
                    ↩ Revert
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--sm cards__del"
                  onClick={() => {
                    deleteCard(selected.id); // recoverable trash — restore below
                    setSelectedId("");
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="cards__tags">
              {selected.tags.length ? (
                selected.tags.map((t) => (
                  <span key={t} className="chip">#{t}</span>
                ))
              ) : (
                <span className="faint mono">no tags</span>
              )}
              {editing && (
                <input
                  className="field cards__tag-input"
                  placeholder="tags, comma-separated"
                  defaultValue={selected.tags.join(", ")}
                  onBlur={(e) =>
                    updateCard(selected.id, {
                      tags: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  aria-label="Card tags"
                />
              )}
            </div>

            {editing ? (
              <>
                <textarea
                  className="field cards__body-input"
                  value={selected.body ?? ""}
                  onChange={(e) => updateCard(selected.id, { body: e.target.value })}
                  aria-label="Card body"
                  placeholder="Write the card… Use [[Card Title]] to link and #tags to tag."
                />
                <p className="faint mono cards__hint">
                  [[Title]] links to another card · #word becomes a tag on save
                </p>
              </>
            ) : (
              <p className="cards__body">
                {selected.body ? (
                  <WikiBody
                    body={selected.body}
                    onNavigate={open}
                    onCreate={(title) => addCard(title)}
                  />
                ) : (
                  <span className="faint">Empty card.</span>
                )}
              </p>
            )}

            {editing && (
              <div className="cards__linker">
                <p className="eyebrow">Link to cards</p>
                <div className="cards__link-choices">
                  {cards
                    .filter((c) => c.id !== selected.id)
                    .map((c) => (
                      <button
                        key={c.id}
                        className={`chip cards__link-choice ${
                          selected.card?.links.includes(c.id) ? "is-linked" : ""
                        }`}
                        onClick={() => toggleLink(c.id)}
                      >
                        {selected.card?.links.includes(c.id) ? "✓ " : "+ "}
                        {c.title || "Untitled"}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {(linked.length > 0 || backlinks.length > 0) && (
              <div className="cards__graph">
                {linked.length > 0 && (
                  <div className="cards__graph-col">
                    <p className="eyebrow">Links to →</p>
                    {linked.map((c: SystemObject) => (
                      <button key={c.id} className="cards__graph-link" onClick={() => open(c.id)}>
                        {c.title || "Untitled"}
                        <span className="mono faint"> {OBJECT_TYPE_META[c.type].glyph}</span>
                      </button>
                    ))}
                  </div>
                )}
                {backlinks.length > 0 && (
                  <div className="cards__graph-col">
                    <p className="eyebrow">← Linked from</p>
                    {backlinks.map((c: SystemObject) => (
                      <button key={c.id} className="cards__graph-link" onClick={() => open(c.id)}>
                        {c.title || "Untitled"}
                        <span className="mono faint"> {OBJECT_TYPE_META[c.type].glyph}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {related.length > 0 && (
              <div className="cards__related">
                <p className="eyebrow">Related by tags</p>
                <div className="cards__link-choices">
                  {related.map((hit) => (
                    <button
                      key={hit.object.id}
                      className="chip cards__link-choice"
                      onClick={() => open(hit.object.id)}
                      title={`Shares #${hit.matchedTags.join(", #")}`}
                    >
                      {hit.object.title || "Untitled"} · #{hit.matchedTags[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="faint">No card selected.</p>
        )}

        <Section title="About this app">
          <FutureNote
            items={[
              "A full graph view with clustering by tag and project",
              "Attach card context to an AI conversation",
              "AI-suggested links and tags — proposed for your approval",
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
