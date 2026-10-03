/*
 * HomeTile — the header as a customizable edge widget (issues #6, #7, #10).
 * ---------------------------------------------------------------------------
 * A header segment renders an ordered list of HeaderItems — the header's own,
 * much simpler widget system. Items can be added, removed, and reordered
 * (Customize…), and segments can sit on any edge, even several edges at once.
 *
 * Five controls are required and always survive somewhere across segments:
 * the logo (always returns to the Dashboard), the Dashboard ↔ Focus switcher,
 * Freeform, Apps, and Settings — so the user can always find every surface
 * again. While Freeform is active, its controls render here in the header
 * (Save as Workspace / Save as Dashboard / discard / to Scratchpad) instead of
 * a popup banner.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { TileProps } from "./registry";
import type { HeaderItem } from "@/types";
import { useShell } from "@/core/shell";
import { useNow } from "@/core/hooks";
import { useAppearance } from "@/core/AppearanceProvider";
import { storage, StoreKeys } from "@/core/storage";
import {
  getDesktop,
  getMode,
  getActiveLayout,
  getSavedAt,
  subscribe as subscribeDesktop,
  subscribeSaved,
  enterFreeform,
  exitFreeformApply,
  exitFreeformDiscard,
  exitFreeformSaveAs,
  exitFreeformToScratchpad,
  goToDashboard,
  switchToFocus,
  defocus,
  focusApp,
  focusDetached,
  makeTile,
  headerItems,
  shuffleTiles,
} from "@/core/desktop";
import { getNotifications, unreadCount, subscribe as subscribeNotifications } from "@/core/notifications";
import { formatTime } from "@/core/cores/time";
import { assistantStatus, useAssistantName } from "./AssistantTile";

function useSavedFlash(): boolean {
  const savedAt = useSyncExternalStore(subscribeSaved, getSavedAt);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), 1800);
    return () => window.clearTimeout(id);
  }, [savedAt]);
  return visible;
}

function BatteryGlance() {
  const [pct, setPct] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener(t: string, cb: () => void): void;
      }>;
    };
    if (!nav.getBattery) return;
    let disposed = false;
    nav.getBattery().then((b) => {
      if (disposed) return;
      const read = () => {
        setPct(Math.round(b.level * 100));
        setCharging(b.charging);
      };
      read();
      b.addEventListener("levelchange", read);
      b.addEventListener("chargingchange", read);
    });
    return () => {
      disposed = true;
    };
  }, []);
  if (pct === null) return null;
  return (
    <span className="homew__battery mono" title={charging ? "Charging" : "On battery"}>
      {charging ? "↯" : "▮"} {pct}%
    </span>
  );
}

/** The Freeform control cluster, in the header while Freeform is active (issue #7). */
function FreeformControls({ roomy }: { roomy: boolean }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const baseIsDashboard = getDesktop().freeform?.baseId === "dashboard";

  if (saving) {
    return (
      <form
        className="homew__ffsave"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) exitFreeformSaveAs(name);
        }}
      >
        <input
          className="field homew__ffname"
          placeholder="Workspace name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button className="homew__item homew__ffbtn" type="submit">Save</button>
        <button className="homew__item" type="button" onClick={() => setSaving(false)}>✕</button>
      </form>
    );
  }
  return (
    <span className="homew__ff">
      <button className="homew__item homew__ffbtn" onClick={() => setSaving(true)} title="Save this arrangement as a named Workspace">
        Save as Workspace
      </button>
      <button
        className="homew__item homew__ffbtn"
        onClick={exitFreeformApply}
        title={baseIsDashboard ? "Apply this arrangement to the Dashboard" : "Apply this arrangement to the current layout"}
      >
        {baseIsDashboard ? "Save as Dashboard" : "Apply to layout"}
      </button>
      {roomy && (
        <button className="homew__item" onClick={exitFreeformToScratchpad} title="Move temporary tiles to the Scratchpad, then leave">
          To Scratchpad
        </button>
      )}
      <button className="homew__item" onClick={exitFreeformDiscard} title="Return without saving">
        Discard
      </button>
    </span>
  );
}

export function HomeTile({ tile, size, slow, px }: TileProps) {
  useSyncExternalStore(subscribeDesktop, getDesktop);
  const shell = useShell();
  const { appearance } = useAppearance();
  const now = useNow(slow ? 60000 : 15000);
  const mode = getMode();
  const layout = getActiveLayout();
  const saved = useSavedFlash();

  const name = useAssistantName();
  const provider = useSyncExternalStore(
    (cb) => storage.subscribe(StoreKeys.aiProvider, cb),
    () => storage.get<string>(StoreKeys.aiProvider, "none"),
  );
  const ai = assistantStatus(name, provider);

  useSyncExternalStore(subscribeNotifications, getNotifications);
  // Snooze-aware: quiet-hours-held items do not badge until released.
  const unread = unreadCount();

  const w = px?.w ?? 1200;
  const h = px?.h ?? 48;
  const vertical = h > w;
  const length = vertical ? h : w;
  const roomy = length >= 640;
  const medium = length >= 380;

  const items = headerItems(tile);

  const brand = (
    <button className="homew__brand" onClick={goToDashboard} title="Locus — go to the Dashboard">
      <span className="homew__mark mono" aria-hidden>⌂</span>
      {length >= 200 && !vertical && <span className="homew__brand-name">{appearance.systemName}</span>}
    </button>
  );

  // Icon-sized: the segment is just the mark. The behavior stays invariant.
  if (size === "tiny" && Math.min(w, h) < 46) {
    return <div className="tilec homew homew--icon">{brand}</div>;
  }

  function renderItem(item: HeaderItem) {
    switch (item.kind) {
      case "logo":
        return brand;
      case "mode":
        // Dashboard ↔ Focus switcher (issue #6). Focus reopens the last
        // focused app; with none, Focus is just empty space.
        return (
          <span className="homew__switch" role="group" aria-label="Mode">
            <button
              className={`homew__switch-btn ${mode !== "focus" ? "is-active" : ""}`}
              onClick={() => (mode === "focus" ? defocus() : goToDashboard())}
              title="Dashboard Mode"
            >
              {medium ? "Dashboard" : "⌗"}
            </button>
            <button
              className={`homew__switch-btn ${mode === "focus" ? "is-active" : ""}`}
              onClick={switchToFocus}
              title="Focus Mode — reopens the last focused app"
            >
              {medium ? "Focus" : "⤢"}
            </button>
          </span>
        );
      case "freeform":
        if (mode === "freeform") return <FreeformControls roomy={roomy} />;
        return (
          <button
            className="homew__item homew__freeform"
            onClick={enterFreeform}
            title="Enter Freeform — temporary layout changes"
          >
            {medium ? "Freeform" : "◇"}
          </button>
        );
      case "apps":
        return (
          <button className="homew__item" onClick={() => focusDetached(makeTile("apps"))} title="Apps">
            <span className="mono" aria-hidden>⊞</span>
            {roomy && <span>Apps</span>}
          </button>
        );
      case "settings":
        return (
          <button className="homew__item" onClick={() => focusApp("settings")} title="Settings">
            <span className="mono" aria-hidden>⚙</span>
          </button>
        );
      case "spacer":
        return <span className="homew__spring" aria-hidden />;
      case "workspace":
        // The mode switcher already says where you are; this names the layout.
        return (
          <span className="homew__wsgroup">
            {!layout.builtIn && <span className={`homew__mode homew__mode--${mode}`}>{layout.name}</span>}
            {mode === "freeform" && <span className="homew__mode homew__mode--freeform">Freeform</span>}
            {saved && mode !== "freeform" && medium && (
              <span className="homew__saved mono" role="status">Saved ✓</span>
            )}
          </span>
        );
      case "shuffle":
        // Shuffle: repack every tile so there are no gaps (issue #8).
        return (
          <button
            className="homew__item"
            onClick={shuffleTiles}
            title="Shuffle — rearrange and resize all tiles so there are no gaps"
          >
            <span className="mono" aria-hidden>⤨</span>
            {roomy && <span>Shuffle</span>}
          </button>
        );
      case "search":
        return (
          <button className="homew__item" onClick={shell.openPalette} title="Command palette (Ctrl K)">
            <span className="mono" aria-hidden>⌕</span>
            {roomy && <kbd className="homew__kbd mono">Ctrl K</kbd>}
          </button>
        );
      case "ai":
        return (
          <button className="homew__item homew__ai" onClick={() => focusApp("assistant")} title={ai.line}>
            <span className={`dot ${ai.ok ? "dot--on" : "dot--off"}`} aria-hidden />
            {roomy && <span className="homew__ai-name">{name}</span>}
          </button>
        );
      case "notifications":
        return (
          <button
            className="homew__item"
            onClick={() => focusDetached(makeTile("notifications"))}
            title={`${unread} unread notification${unread === 1 ? "" : "s"}`}
          >
            <span className="mono" aria-hidden>◍</span>
            {unread > 0 && <span className="homew__badge mono">{unread}</span>}
          </button>
        );
      case "battery":
        return medium ? <BatteryGlance /> : null;
      case "clock":
        // Through Time Core's formatTime, so the 12/24h preference applies.
        return <span className="homew__time mono">{formatTime(now)}</span>;
      case "scratchpad":
        return (
          <button className="homew__item" onClick={() => focusDetached(makeTile("scratchpad"))} title="Scratchpad">
            <span className="mono" aria-hidden>▤</span>
          </button>
        );
      default:
        return null;
    }
  }

  return (
    <div className={`tilec homew ${vertical ? "homew--vertical" : ""}`}>
      {items.map((item) => {
        const node = renderItem(item);
        return node === null ? null : (
          <span className="homew__slot" key={item.id}>
            {node}
          </span>
        );
      })}
    </div>
  );
}
