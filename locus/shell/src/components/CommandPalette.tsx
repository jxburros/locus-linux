/*
 * CommandPalette — Cmd/Ctrl-K.
 * A keyboard-first overlay to jump to any app or run a system command. The
 * command list comes from core/commands (generated off the registry), so it
 * grows automatically with new apps. Built to later fold in documents, cards,
 * tasks, and AI actions as extra result groups.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "@/core/shell";
import { useAppearance } from "@/core/AppearanceProvider";
import { buildCommands, scoreCommand, type Command } from "@/core/commands";

interface CommandPaletteProps {
  onClose: () => void;
}

export default function CommandPalette({ onClose }: CommandPaletteProps) {
  const { openApp, goHome } = useShell();
  const { update } = useAppearance();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const resolvedTheme =
    (document.documentElement.getAttribute("data-theme") as "light" | "dark") ?? "dark";

  const commands = useMemo(
    () =>
      buildCommands({
        openApp,
        goHome,
        currentTheme: resolvedTheme,
        toggleTheme: () =>
          update({ theme: resolvedTheme === "dark" ? "light" : "dark" }),
      }),
    [openApp, goHome, update, resolvedTheme],
  );

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: scoreCommand(c, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
  }, [commands, query]);

  // Keep the cursor in range as results change.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function runAt(index: number) {
    const cmd = results[index];
    if (cmd) {
      cmd.run();
      onClose();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Group results for display while keeping a flat index for keyboard nav.
  let flatIndex = -1;
  const groups: { name: string; items: { cmd: Command; index: number }[] }[] = [];
  for (const cmd of results) {
    flatIndex += 1;
    const g = groups.find((x) => x.name === cmd.group);
    const entry = { cmd, index: flatIndex };
    if (g) g.items.push(entry);
    else groups.push({ name: cmd.group, items: [entry] });
  }

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette__scrim" onClick={onClose} />
      <div className="palette__panel" onKeyDown={onKeyDown}>
        <div className="palette__input-row">
          <span className="palette__input-icon mono" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Search apps or run a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            aria-label="Command palette input"
            aria-activedescendant={results[cursor] ? `cmd-${results[cursor].id}` : undefined}
          />
          <kbd className="palette__esc mono">esc</kbd>
        </div>

        {results.length ? (
          <ul className="palette__list" ref={listRef}>
            {groups.map((group) => (
              <li key={group.name} className="palette__group">
                <p className="eyebrow palette__group-label">{group.name}</p>
                <ul>
                  {group.items.map(({ cmd, index }) => (
                    <li key={cmd.id}>
                      <button
                        id={`cmd-${cmd.id}`}
                        className={`palette__item ${index === cursor ? "is-active" : ""}`}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => runAt(index)}
                      >
                        <span className="palette__item-icon mono" aria-hidden>
                          {cmd.icon ?? "›"}
                        </span>
                        <span className="palette__item-label">{cmd.label}</span>
                        {cmd.hint && <span className="palette__item-hint faint mono">{cmd.hint}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="palette__empty faint">No commands match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
