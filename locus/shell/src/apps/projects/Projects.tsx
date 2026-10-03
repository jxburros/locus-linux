/*
 * Projects — hubs that link documents, cards, tasks, and files.
 * Backed by the shared object store: a project is a real object, and its
 * sections show the actual objects linked into it (by projectIds). You can
 * create projects and link/unlink any object, so the "one object, many apps"
 * model becomes visible and navigable.
 */

import { useMemo, useState } from "react";
import { useObjects } from "@/core/hooks";
import { createObject, updateObject, linkToProject, unlinkFromProject } from "@/core/objects";
import { useShell } from "@/core/shell";
import type { ObjectType, SystemObject } from "@/types";
import { OBJECT_TYPE_META } from "@/types";
import { Section, FutureNote } from "@/components/ui";
import "./projects.css";

const LINKABLE: ObjectType[] = ["document", "card", "task", "file"];
const APP_FOR_TYPE: Record<string, "writer" | "cards" | "tasks" | "files"> = {
  document: "writer",
  card: "cards",
  task: "tasks",
  file: "files",
};

export default function Projects() {
  const all = useObjects();
  const { openApp } = useShell();
  const projects = useMemo(() => all.filter((o) => o.type === "project"), [all]);
  const [selectedId, setSelectedId] = useState("");
  const [linking, setLinking] = useState(false);

  const project = projects.find((p) => p.id === selectedId) ?? projects[0];
  const members = useMemo(
    () => (project ? all.filter((o) => o.projectIds.includes(project.id)) : []),
    [all, project],
  );

  function grouped(type: ObjectType): SystemObject[] {
    return members.filter((m) => m.type === type);
  }

  function newProject() {
    const p = createObject({
      type: "project",
      title: "New project",
      project: { summary: "" },
    });
    setSelectedId(p.id);
  }

  const unlinked = project
    ? all.filter(
        (o) => LINKABLE.includes(o.type) && !o.projectIds.includes(project.id),
      )
    : [];

  return (
    <div className="projects">
      <div className="projects__list">
        <button className="btn btn--primary btn--sm projects__new" onClick={newProject}>
          + New project
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`projects__item ${p.id === project?.id ? "is-active" : ""}`}
            onClick={() => setSelectedId(p.id)}
          >
            <span className="projects__item-name">{p.title}</span>
            <span className="projects__item-summary muted">
              {p.project?.summary || "No summary yet."}
            </span>
          </button>
        ))}
        {projects.length === 0 && <p className="faint projects__empty">No projects yet.</p>}
      </div>

      {project ? (
        <div className="projects__detail">
          <input
            className="projects__title-input"
            value={project.title}
            onChange={(e) => updateObject(project.id, { title: e.target.value })}
            aria-label="Project name"
          />
          <textarea
            className="field projects__summary-input"
            value={project.project?.summary ?? ""}
            onChange={(e) =>
              updateObject(project.id, { project: { summary: e.target.value } })
            }
            placeholder="What is this project about?"
            aria-label="Project summary"
          />

          <div className="projects__grid">
            {LINKABLE.map((type) => {
              const items = grouped(type);
              return (
                <div key={type} className="projects__section panel">
                  <div className="projects__section-head">
                    <span className="eyebrow">{OBJECT_TYPE_META[type].plural}</span>
                    <span className="mono faint">{items.length}</span>
                  </div>
                  {items.length ? (
                    <ul className="projects__members">
                      {items.map((m) => (
                        <li key={m.id} className="projects__member">
                          <button
                            className="projects__member-open"
                            onClick={() => openApp(APP_FOR_TYPE[type])}
                            title={`Open in ${APP_FOR_TYPE[type]}`}
                          >
                            <span className="mono faint" aria-hidden>
                              {OBJECT_TYPE_META[type].glyph}
                            </span>{" "}
                            {m.title || "Untitled"}
                          </button>
                          <button
                            className="projects__unlink"
                            onClick={() => unlinkFromProject(m.id, project.id)}
                            aria-label={`Unlink ${m.title}`}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="faint projects__section-hint">
                      No linked {OBJECT_TYPE_META[type].plural.toLowerCase()} yet.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="projects__linker">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setLinking((v) => !v)}
              aria-expanded={linking}
            >
              {linking ? "Done linking" : "Link objects…"}
            </button>
            {linking && (
              <div className="projects__link-choices">
                {unlinked.length ? (
                  unlinked.map((o) => (
                    <button
                      key={o.id}
                      className="chip projects__link-choice"
                      onClick={() => linkToProject(o.id, project.id)}
                    >
                      + <span className="mono faint">{OBJECT_TYPE_META[o.type].glyph}</span>{" "}
                      {o.title || "Untitled"}
                    </button>
                  ))
                ) : (
                  <span className="faint">Everything is already linked.</span>
                )}
              </div>
            )}
          </div>

          <Section title="About this app">
            <FutureNote
              items={[
                "Decision records and an automatic changelog",
                "Project context packs handed to the AI as one bundle",
              ]}
            />
          </Section>
        </div>
      ) : (
        <div className="projects__detail">
          <p className="faint">Create a project to begin linking your work.</p>
        </div>
      )}
    </div>
  );
}
