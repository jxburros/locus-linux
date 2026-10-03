/*
 * Contacts — the user-facing surface over People Core (directive §10).
 * Contacts with categories, groups, birthdays, per-contact follow-up cadence,
 * interaction channels, and history — all Core state, no app-private math:
 * the "follow up?" badge comes from cadenceHealth/dueFollowUps (so a custom
 * cadence badges correctly), and "never contacted" is its own state. Cross-
 * core on purpose: notes about a person are Cardspoke cards, birthday
 * reminders are yearly Time Core entries, and cadence is one click away
 * from a Monitor Core watch.
 */

import { useState, useSyncExternalStore } from "react";
import {
  listContacts,
  subscribeContacts,
  addContact,
  updateContact,
  removeContact,
  archiveContact,
  restoreContact,
  archivedContacts,
  logInteraction,
  cadenceHealth,
  dueFollowUps,
  scheduleBirthdayReminder,
  INTERACTION_CHANNELS,
  DEFAULT_CADENCE_DAYS,
  type Contact,
  type InteractionChannel,
} from "@/core/cores/people";
import { createCard } from "@/core/cores/cardspoke";
import { formatDateTime } from "@/core/cores/time";
import { createWatch, listWatches } from "@/core/cores/monitor";
import { getObject } from "@/core/objects";
import { focusApp } from "@/core/desktop";
import { Section, FutureNote, Toolbar, EmptyState } from "@/components/ui";
import "./people.css";

const CATEGORIES = ["Friend", "Family", "Work", "Community", "Plant Pal"];

function daysSinceTs(ts?: number): number | null {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

function HealthBadge({ contact }: { contact: Contact }) {
  const health = cadenceHealth(contact);
  if (health === null) return <span className="people__stale mono">never contacted</span>;
  if (health <= 0) return <span className="people__stale mono">follow up?</span>;
  const pct = Math.round(health * 100);
  return (
    <span className="mono faint" title={`Cadence health (window: ${contact.followUpDays ?? DEFAULT_CADENCE_DAYS}d)`}>
      {pct}%
    </span>
  );
}

function ContactRow({ contact, due }: { contact: Contact; due: boolean }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<InteractionChannel>("in-person");
  const since = daysSinceTs(contact.lastContactAt);
  const notesCard = contact.notesCardId ? getObject(contact.notesCardId) : undefined;
  const history = (contact.interactions ?? []).slice(0, 5);

  function openNotes() {
    if (notesCard) {
      focusApp("cards");
      return;
    }
    const card = createCard({
      type: "card",
      title: `Notes: ${contact.name}`,
      body: "",
      tags: ["person"],
    });
    updateContact(contact.id, { notesCardId: card.id });
    focusApp("cards");
  }

  return (
    <li className="people__row">
      <button className="people__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="people__name">{contact.name}</span>
        {contact.nickname && <span className="faint">“{contact.nickname}”</span>}
        <span className="chip">{contact.category}</span>
        {contact.groups.map((g) => (
          <span key={g} className="chip people__group">{g}</span>
        ))}
        {due && <span className="people__stale mono">follow up?</span>}
        {!due && <HealthBadge contact={contact} />}
        <span className="mono faint people__since">
          {since === null ? "—" : since === 0 ? "contacted today" : `${since}d ago`}
        </span>
      </button>

      {open && (
        <div className="people__detail">
          <div className="people__fields">
            <label>
              <span className="faint">Nickname</span>
              <input className="field" value={contact.nickname ?? ""} onChange={(e) => updateContact(contact.id, { nickname: e.target.value })} />
            </label>
            <label>
              <span className="faint">Email</span>
              <input className="field" value={contact.email ?? ""} onChange={(e) => updateContact(contact.id, { email: e.target.value })} />
            </label>
            <label>
              <span className="faint">Phone</span>
              <input className="field" value={contact.phone ?? ""} onChange={(e) => updateContact(contact.id, { phone: e.target.value })} />
            </label>
            <label>
              <span className="faint">Category</span>
              <select className="field" value={contact.category} onChange={(e) => updateContact(contact.id, { category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="faint">Groups (comma-separated)</span>
              <input
                className="field"
                value={contact.groups.join(", ")}
                onChange={(e) =>
                  updateContact(contact.id, {
                    groups: e.target.value.split(",").map((g) => g.trim()).filter(Boolean),
                  })
                }
              />
            </label>
            <label>
              <span className="faint">Birthday</span>
              <input className="field" type="date" value={contact.birthday ?? ""} onChange={(e) => updateContact(contact.id, { birthday: e.target.value })} />
            </label>
            <label>
              <span className="faint">Follow-up every (days)</span>
              <input
                className="field"
                type="number"
                min={1}
                value={contact.followUpDays ?? DEFAULT_CADENCE_DAYS}
                onChange={(e) =>
                  updateContact(contact.id, {
                    followUpDays: Math.max(1, Number(e.target.value) || DEFAULT_CADENCE_DAYS),
                  })
                }
                title="This contact's own cadence — the badge and Monitor use it"
              />
            </label>
          </div>
          <div className="people__actions">
            <select
              className="field people__channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as InteractionChannel)}
              aria-label="Interaction channel"
            >
              {INTERACTION_CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="btn btn--sm btn--primary" onClick={() => logInteraction(contact.id, channel)}>
              Log interaction
            </button>
            <button className="btn btn--sm" onClick={openNotes}>
              {notesCard ? "Open notes card" : "Create notes card"}
            </button>
            {contact.birthday && (
              <button
                className="btn btn--sm"
                onClick={() => scheduleBirthdayReminder(contact.id)}
                title="Creates a yearly reminder in Time Core (Feb 29 clamps to Feb 28 off-leap-years)"
              >
                Remind me yearly
              </button>
            )}
            <button
              className="people__x"
              onClick={() => archiveContact(contact.id)}
              aria-label={`Archive ${contact.name}`}
              title="Archive — the contact and their history are kept and restorable"
            >
              Archive
            </button>
          </div>
          {history.length > 0 && (
            <div className="people__history">
              <p className="eyebrow">Recent interactions</p>
              <ul>
                {history.map((ix) => (
                  <li key={ix.id} className="mono faint">
                    {ix.channel} · {formatDateTime(ix.at)}
                    {ix.note ? ` — ${ix.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ArchivedRow({ contact }: { contact: Contact }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <li className="people__row people__row--archived">
      <span className="people__name faint">{contact.name}</span>
      <span className="people__actions">
        <button className="btn btn--sm" onClick={() => restoreContact(contact.id)}>
          Restore
        </button>
        {confirmDelete ? (
          <>
            <button className="btn btn--sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn btn--sm people__x"
              onClick={() => removeContact(contact.id)}
              aria-label={`Permanently delete ${contact.name}`}
            >
              Delete forever
            </button>
          </>
        ) : (
          <button className="btn btn--sm people__x" onClick={() => setConfirmDelete(true)}>
            Delete…
          </button>
        )}
      </span>
    </li>
  );
}

export default function People() {
  useSyncExternalStore(subscribeContacts, listContacts);
  const contacts = listContacts();
  const archived = archivedContacts();
  const due = new Set(dueFollowUps().map((c) => c.id));
  const [draft, setDraft] = useState("");
  const cadenceWatchExists = listWatches().some((w) => w.type === "contact-cadence");

  function add() {
    if (!draft.trim()) return;
    addContact({ name: draft });
    setDraft("");
  }

  return (
    <div className="people">
      <Toolbar>
        <input
          className="field people__grow"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a contact and press Enter"
          aria-label="New contact name"
        />
        <button className="btn btn--primary" onClick={add}>Add</button>
      </Toolbar>

      {!cadenceWatchExists && contacts.length > 0 && (
        <p className="people__hint faint">
          Cross-core:{" "}
          <button
            className="people__link"
            onClick={() =>
              createWatch({
                name: "Contact follow-up cadence",
                type: "contact-cadence",
                params: { days: DEFAULT_CADENCE_DAYS },
              })
            }
          >
            let Monitor watch for contacts past their follow-up window
          </button>{" "}
          (each contact's own cadence applies).
        </p>
      )}

      <Section title={`Contacts (${contacts.length})`}>
        {contacts.length === 0 ? (
          <EmptyState title="No contacts yet" hint="People Core also powers the future Plant Pal — same Core, different surface." />
        ) : (
          <ul className="people__list">
            {contacts.map((c) => (
              <ContactRow key={c.id} contact={c} due={due.has(c.id)} />
            ))}
          </ul>
        )}
      </Section>

      {archived.length > 0 && (
        <Section title={`Archived (${archived.length})`}>
          <ul className="people__list">
            {archived.map((c) => (
              <ArchivedRow key={c.id} contact={c} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="About this app">
        <FutureNote
          items={[
            "Plant Pal — care schedules on People Core + Time Core",
            "Mail/calendar integration through connected sources",
          ]}
        />
      </Section>
    </div>
  );
}
