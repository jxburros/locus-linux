/*
 * The system-surface widgets: Apps launcher, Workspaces switcher, Settings
 * quick controls, and the Scratchpad.
 * ---------------------------------------------------------------------------
 * Apps is where new tiles come from and where removed/replaced tiles are
 * returned from; entries can be clicked to focus or dragged straight onto the
 * desktop. Workspaces switches and manages named saved layouts. Scratchpad is
 * the visible holding tank — not a taskbar, not minimized windows.
 */

import { useState, useSyncExternalStore } from "react";
import type { TileProps } from "./registry";
import { useShell } from "@/core/shell";
import { useDesktopDnD } from "../desktop/dnd";
import { APPS } from "@/core/appRegistry";
import { BUILTIN_TILE_KINDS, TILE_META } from "@/core/tileMeta";
import { useAppearance } from "@/core/AppearanceProvider";
import { ACCENTS } from "@/core/theme";
import { useStoredValue } from "@/core/hooks";
import { StoreKeys } from "@/core/storage";
import type { DesktopLayout, ScratchItem } from "@/types";
import {
  getDesktop,
  getScratchpad,
  getWorkspaces,
  getLowPower,
  setLowPower,
  subscribe as subscribeDesktop,
  addTile,
  switchLayout,
  isDashboardActive,
  getActiveLayout,
  enterFreeform,
  saveCurrentAsWorkspace,
  renameWorkspace,
  duplicateWorkspace,
  deleteWorkspace,
  setWorkspaceOption,
  resetDashboard,
  exportWorkspace,
  focusDetached,
  focusApp,
  scratchPin,
  scratchRemove,
  clearScratchpad,
  promoteScratchItem,
  tileIcon,
  tileName,
} from "@/core/desktop";

function useDesktopVersion(): unknown {
  return useSyncExternalStore(subscribeDesktop, getDesktop);
}

/* ----------------------------------- Apps ---------------------------------- */

export function AppsTile({ size }: TileProps) {
  const dnd = useDesktopDnD();
  useDesktopVersion();
  const [query, setQuery] = useState("");
  const placedKinds = new Set(getActiveLayout().tiles.map((t) => (t.kind === "app" ? `app:${t.app}` : t.kind)));

  const q = query.trim().toLowerCase();
  const apps = APPS.filter(
    (a) => !q || `${a.name} ${a.description} ${(a.keywords ?? []).join(" ")}`.toLowerCase().includes(q),
  );
  const widgets = BUILTIN_TILE_KINDS.filter((k) => {
    const m = TILE_META[k];
    return !q || `${m.name} ${m.description} ${m.keywords.join(" ")}`.toLowerCase().includes(q);
  });

  if (size === "tiny" || size === "small") {
    const shown = BUILTIN_TILE_KINDS.slice(0, size === "tiny" ? 4 : 6);
    return (
      <div className="tilec apps apps--glance">
        <div className="apps__grid">
          {shown.map((k) => (
            <button
              key={k}
              className="apps__cell"
              title={`${TILE_META[k].name} — drag to place`}
              onPointerDown={(e) => dnd.beginDrag({ type: "add", kind: k }, e)}
              onClick={() => addTile(k)}
            >
              <span className="mono" aria-hidden>{TILE_META[k].icon}</span>
            </button>
          ))}
        </div>
        <span className="faint tilec__hint">Drag out to place</span>
      </div>
    );
  }

  return (
    <div className="tilec apps">
      {size === "large" && (
        <input
          className="field"
          placeholder="Search apps, widgets, anchors…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the launcher"
        />
      )}

      <p className="eyebrow">Apps</p>
      <ul className="apps__list">
        {apps.map((a) => (
          <li key={a.id} className="apps__row">
            <button
              className="apps__launch"
              onPointerDown={(e) => dnd.beginDrag({ type: "add", kind: "app", app: a.id }, e)}
              onClick={() => focusApp(a.id)}
              title={`Open ${a.name}, or drag onto the desktop`}
            >
              <span className="mono apps__icon" aria-hidden>{a.icon}</span>
              <span className="apps__name">{a.name}</span>
              {size === "large" && <span className="faint apps__desc">{a.description}</span>}
            </button>
            <button
              className="tilec__link"
              onClick={() => addTile("app", { app: a.id })}
              title={`Place ${a.name} on the desktop`}
            >
              {placedKinds.has(`app:${a.id}`) ? "+ again" : "+ place"}
            </button>
          </li>
        ))}
      </ul>

      <p className="eyebrow">Widgets &amp; anchors</p>
      <ul className="apps__list">
        {widgets.map((k) => {
          const m = TILE_META[k];
          return (
            <li key={k} className="apps__row">
              <button
                className="apps__launch"
                onPointerDown={(e) => dnd.beginDrag({ type: "add", kind: k }, e)}
                onClick={() => addTile(k)}
                title={`Add ${m.name} — click to place, or drag onto the desktop`}
              >
                <span className="mono apps__icon" aria-hidden>{m.icon}</span>
                <span className="apps__name">{m.name}</span>
                <span className="chip">{m.tileClass}</span>
                {size === "large" && <span className="faint apps__desc">{m.description}</span>}
              </button>
              <button className="tilec__link" onClick={() => addTile(k)}>
                {placedKinds.has(k) ? "+ again" : "+ place"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="faint tilec__hint">
        Removed or replaced tiles come back from here. Drag any entry straight onto the desktop.
      </p>
    </div>
  );
}

/* -------------------------------- Workspaces ------------------------------- */

function download(name: string, text: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = `${name.replace(/\s+/g, "-").toLowerCase()}.locus-workspace.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function WorkspaceRow({ ws }: { ws: DesktopLayout }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(ws.name);
  return (
    <li className="wsm__row">
      {renaming ? (
        <form
          className="wsm__rename"
          onSubmit={(e) => {
            e.preventDefault();
            renameWorkspace(ws.id, name);
            setRenaming(false);
          }}
        >
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button className="btn btn--sm" type="submit">Save</button>
        </form>
      ) : (
        <button className="wsm__open" onClick={() => switchLayout(ws.id)}>
          <span className="wsm__name">{ws.name}</span>
          <span className="faint mono">{ws.tiles.length} tiles</span>
        </button>
      )}
      <span className="wsm__actions">
        <button className="tilec__link" onClick={() => setRenaming((v) => !v)}>rename</button>
        <button className="tilec__link" onClick={() => duplicateWorkspace(ws.id)}>duplicate</button>
        <button className="tilec__link" onClick={() => download(ws.name, exportWorkspace(ws.id))}>export</button>
        <button className="tilec__link tm__stop" onClick={() => deleteWorkspace(ws.id)}>delete</button>
      </span>
      <label className="wsm__opt faint">
        <input
          type="checkbox"
          checked={Boolean(ws.ownScratchpad)}
          onChange={(e) => setWorkspaceOption(ws.id, { ownScratchpad: e.target.checked })}
        />
        own Scratchpad
      </label>
    </li>
  );
}

export function WorkspacesTile({ size }: TileProps) {
  useDesktopVersion();
  const workspaces = getWorkspaces();
  const active = getActiveLayout();
  const [saveName, setSaveName] = useState("");

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">{workspaces.length + 1}</span>
        <span className="faint">saved layouts</span>
      </div>
    );
  }

  const switcher = (
    <ul className="wsw__list">
      <li>
        <button
          className={`wsw__item ${isDashboardActive() ? "is-active" : ""}`}
          onClick={() => switchLayout("dashboard")}
        >
          Dashboard
        </button>
      </li>
      {workspaces.map((w) => (
        <li key={w.id}>
          <button
            className={`wsw__item ${active.id === w.id ? "is-active" : ""}`}
            onClick={() => switchLayout(w.id)}
          >
            {w.name}
          </button>
        </li>
      ))}
      {workspaces.length === 0 && (
        <li className="faint wsw__empty">No saved workspaces yet — build one in Freeform.</li>
      )}
    </ul>
  );

  if (size === "small" || size === "medium") {
    return (
      <div className="tilec wsw">
        {switcher}
        {size === "medium" && (
          <p className="wsw__actions">
            <button className="tilec__link" onClick={enterFreeform}>Enter Freeform</button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="tilec wsw wsm">
      {switcher}
      <p className="eyebrow">Manage</p>
      <ul className="wsm__rows">
        {workspaces.map((w) => (
          <WorkspaceRow key={w.id} ws={w} />
        ))}
      </ul>
      <form
        className="tilec__inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (saveName.trim()) {
            saveCurrentAsWorkspace(saveName);
            setSaveName("");
          }
        }}
      >
        <input
          className="field"
          placeholder="Save current layout as…"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button className="btn btn--sm" type="submit">Save</button>
      </form>
      <p className="wsw__actions">
        <button className="tilec__link" onClick={enterFreeform}>Enter Freeform to build a layout</button>
        <button className="tilec__link" onClick={resetDashboard}>Reset Dashboard</button>
      </p>
    </div>
  );
}

/* --------------------------------- Settings -------------------------------- */

export function SettingsTile({ size }: TileProps) {
  const { openApp } = useShell();
  const { appearance, update } = useAppearance();
  const [reduced, setReduced] = useStoredValue<boolean>(StoreKeys.reducedMotion, false);
  useDesktopVersion();
  const lowPower = getLowPower();

  const resolvedDark = document.documentElement.getAttribute("data-theme") !== "light";

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <button
          className="tilec__link"
          onClick={() => update({ theme: resolvedDark ? "light" : "dark" })}
        >
          {resolvedDark ? "☀ Light" : "☾ Dark"}
        </button>
      </div>
    );
  }

  return (
    <div className="tilec setq">
      <div className="setq__row">
        <span className="faint">Theme</span>
        <span className="setq__group">
          {(["dark", "light", "system"] as const).map((t) => (
            <button
              key={t}
              className={`chip setq__chip ${appearance.theme === t ? "is-active" : ""}`}
              onClick={() => update({ theme: t })}
            >
              {t}
            </button>
          ))}
        </span>
      </div>
      <div className="setq__row">
        <span className="faint">Accent</span>
        <span className="setq__group">
          {ACCENTS.map((a) => (
            <button
              key={a.name}
              className={`setq__swatch ${appearance.accent === a.name ? "is-active" : ""}`}
              style={{ background: a.swatch }}
              onClick={() => update({ accent: a.name })}
              aria-label={`Accent ${a.label}`}
              title={a.label}
            />
          ))}
        </span>
      </div>
      {size !== "small" && (
        <>
          <div className="setq__row">
            <span className="faint">Motion</span>
            <button className={`chip setq__chip ${reduced ? "is-active" : ""}`} onClick={() => setReduced(!reduced)}>
              {reduced ? "reduced" : "full"}
            </button>
          </div>
          <div className="setq__row">
            <span className="faint">Power</span>
            <button className={`chip setq__chip ${lowPower ? "is-active" : ""}`} onClick={() => setLowPower(!lowPower)}>
              {lowPower ? "low-power" : "normal"}
            </button>
          </div>
        </>
      )}
      <button className="tilec__link" onClick={() => openApp("settings")}>All settings →</button>
    </div>
  );
}

/* -------------------------------- Scratchpad ------------------------------- */

function ScratchCard({ item, size }: { item: ScratchItem; size: "small" | "medium" | "large" }) {
  const dnd = useDesktopDnD();
  return (
    <div className={`scratch__card scratch__card--${size} ${item.pinned ? "is-pinned" : ""}`}>
      <button
        className="scratch__open"
        onPointerDown={(e) => dnd.beginDrag({ type: "scratch", scratchId: item.id }, e)}
        onClick={() => focusDetached(item.tile, item.id)}
        title={`${tileName(item.tile)} — click to focus, drag to place`}
      >
        <span className="mono scratch__icon" aria-hidden>{tileIcon(item.tile)}</span>
        {size !== "small" && <span className="scratch__name">{tileName(item.tile)}</span>}
        <span
          className={`dot ${item.activity === "active" ? "dot--on" : item.activity === "warm" ? "dot--warm" : "dot--off"}`}
          title={item.activity}
          aria-label={`Status: ${item.activity}`}
        />
      </button>
      {size !== "small" && (
        <span className="scratch__actions">
          <button className="tilec__link" onClick={() => promoteScratchItem(item.id)} title="Place on the desktop">
            place
          </button>
          <button
            className={`tilec__link ${item.pinned ? "scratch__pin--on" : ""}`}
            onClick={() => scratchPin(item.id, !item.pinned)}
          >
            {item.pinned ? "unpin" : "pin"}
          </button>
          <button className="tilec__link tm__stop" onClick={() => scratchRemove(item.id)}>×</button>
        </span>
      )}
    </div>
  );
}

export function ScratchpadTile({ size }: TileProps) {
  useDesktopVersion();
  const items = getScratchpad();

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">{items.length}</span>
        <span className="faint">on deck</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="muted">Nothing on deck</span>
        <span className="faint tilec__hint">Drag a tile here to hold it without placing it.</span>
      </div>
    );
  }

  const cardSize = size === "small" ? "small" : size === "medium" ? "medium" : "large";
  return (
    <div className="tilec scratch">
      <div className={`scratch__items scratch__items--${cardSize}`}>
        {items.map((i) => (
          <ScratchCard key={i.id} item={i} size={cardSize} />
        ))}
      </div>
      {size !== "small" && (
        <p className="scratch__foot">
          <span className="faint">
            {items.length} held · {items.filter((i) => i.activity !== "paused").length} active
          </span>
          <button className="tilec__link" onClick={clearScratchpad}>Clear unpinned</button>
        </p>
      )}
    </div>
  );
}
