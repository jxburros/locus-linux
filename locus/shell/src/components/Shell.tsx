/*
 * Shell — the thinnest possible frame around the spatial workspace.
 * ---------------------------------------------------------------------------
 * There is no fixed header, sidebar, or rail anymore: chrome is made from
 * persistent widget tiles inside the Workspace itself (change brief §7–8) —
 * including the Freeform controls, which live in the header segments while
 * Freeform is active (issue #7). The shell only mounts the one surface, the
 * command palette, and first-run onboarding. There is no router and no window
 * manager — "where you are" is the desktop store's mode. ShellContext
 * (openApp = focus an app) keeps the existing app ecosystem running unchanged
 * inside focused tiles.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppId, TileInstance } from "@/types";
import { ShellContext, type ShellState } from "@/core/shell";
import { storage, StoreKeys } from "@/core/storage";
import { record } from "@/core/audit";
import { getApp } from "@/core/appRegistry";
import { TILE_META } from "@/core/tileMeta";
import {
  getDesktop,
  getMode,
  getFocusedTile,
  subscribe as subscribeDesktop,
  focusApp,
  defocus,
  goToDashboard,
} from "@/core/desktop";

import Workspace from "./desktop/Workspace";
import Onboarding from "./desktop/Onboarding";
import CommandPalette from "./CommandPalette";
import "./shell.css";
import "./chrome.css";

const RECENTS_LIMIT = 6;

/** Which registry app (if any) the focused tile represents, for ShellContext. */
function focusedAppId(tile: TileInstance | null): AppId | null {
  if (!tile) return null;
  if (tile.kind === "app") return tile.app ?? null;
  if (tile.kind !== "gap" && tile.kind !== "devwidget") return TILE_META[tile.kind].focusApp ?? null;
  return null;
}

export default function Shell() {
  useSyncExternalStore(subscribeDesktop, getDesktop);
  const activeApp = focusedAppId(getFocusedTile());

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(() =>
    storage.get<boolean>(StoreKeys.desktopOnboarded, false),
  );
  const [recentApps, setRecentApps] = useState<AppId[]>(() =>
    storage.get<AppId[]>(StoreKeys.recentApps, []),
  );

  const openApp = useCallback((id: AppId) => {
    const app = getApp(id);
    if (!app) return;
    focusApp(id);
    setPaletteOpen(false);
    setRecentApps((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENTS_LIMIT);
      storage.set(StoreKeys.recentApps, next);
      return next;
    });
    record({ type: "app.opened", app: id, summary: `Opened ${app.name}` });
  }, []);

  // The invariant home behavior (brief §4): always back to the Dashboard.
  const goHome = useCallback(() => {
    goToDashboard();
    setPaletteOpen(false);
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);

  // Global shortcuts: Ctrl/Cmd-K palette; Escape backs out (palette → focus).
  // Freeform exits stay explicit — Escape never silently discards a draft.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (e.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
        else if (getMode() === "focus") defocus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, togglePalette]);

  const shellValue = useMemo<ShellState>(
    () => ({
      activeApp,
      openApp,
      goHome,
      recentApps,
      paletteOpen,
      openPalette,
      closePalette,
      togglePalette,
    }),
    [activeApp, openApp, goHome, recentApps, paletteOpen, openPalette, closePalette, togglePalette],
  );

  return (
    <ShellContext.Provider value={shellValue}>
      <div className="shell">
        <main className="shell__view" id="main">
          <Workspace />
        </main>
        {paletteOpen && <CommandPalette onClose={closePalette} />}
        {!onboarded && <Onboarding onDone={() => setOnboarded(true)} />}
      </div>
    </ShellContext.Provider>
  );
}
