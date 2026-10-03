/*
 * Tile registry — the component half (metadata lives in core/tileMeta.ts).
 * ---------------------------------------------------------------------------
 * Every tile content component receives the same TileProps and must survive
 * every size class (spec §12): tiny, small, medium, large — plus empty, setup,
 * and error states where they apply. TileContent resolves a TileInstance to
 * the right component; the frame around it lives in desktop/TileFrame.tsx.
 */

import type { ComponentType } from "react";
import type { BuiltinTileKind, SizeClass, TileInstance } from "@/types";
import { TILE_META } from "@/core/tileMeta";

import { ClockTile, BatteryTile, PhotoTile, WeatherTile } from "./systemTiles";
import { AssistantTile } from "./AssistantTile";
import { TaskManagerTile } from "./TaskManagerTile";
import { TodoTile, NotesTile, FilesTile, NotificationsTile } from "./listTiles";
import { MusicTile } from "./MusicTile";
import { AppsTile, WorkspacesTile, SettingsTile, ScratchpadTile } from "./launcherTiles";
import { HomeTile } from "./HomeTile";
import { AppTileContent } from "./AppTile";
import { DevWidgetTile } from "./DevWidgetTile";
import "./tiles.css";

export interface TileProps {
  tile: TileInstance;
  size: SizeClass;
  /** True when rendered in the Focus View's large slot. */
  focused?: boolean;
  /** May run timers / expensive work (false for sleeping tiles). */
  live: boolean;
  /** Reduce update cadence (warm lifecycle or low-power mode). */
  slow: boolean;
  /** Rendered pixel size, when known (the spatial surface always knows). */
  px?: { w: number; h: number };
}

/** Update cadence helper: warm tiles and low-power mode tick 5× slower. */
export function cadence(baseMs: number, slow: boolean): number {
  return slow ? baseMs * 5 : baseMs;
}

export const TILE_COMPONENTS: Record<BuiltinTileKind, ComponentType<TileProps>> = {
  home: HomeTile,
  assistant: AssistantTile,
  taskmanager: TaskManagerTile,
  todo: TodoTile,
  files: FilesTile,
  weather: WeatherTile,
  workspaces: WorkspacesTile,
  apps: AppsTile,
  music: MusicTile,
  notifications: NotificationsTile,
  notes: NotesTile,
  photo: PhotoTile,
  clock: ClockTile,
  battery: BatteryTile,
  settings: SettingsTile,
  scratchpad: ScratchpadTile,
};

export function TileContent(props: TileProps) {
  const { tile } = props;
  if (tile.kind === "gap") {
    return (
      <div className="tilec tilec--gap-inner">
        <span className="faint">Held space</span>
        <span className="faint tilec__hint">Drop a tile here to fill it</span>
      </div>
    );
  }
  if (tile.kind === "app") return <AppTileContent {...props} />;
  if (tile.kind === "devwidget") return <DevWidgetTile {...props} />;
  const C = TILE_COMPONENTS[tile.kind];
  return <C {...props} />;
}

/** Effective lifecycle preference for a tile (user choice or per-kind default). */
export function effectiveLifecycle(tile: TileInstance): "live" | "warm" | "sleeping" {
  if (tile.lifecycle) return tile.lifecycle;
  if (tile.kind === "app" || tile.kind === "gap" || tile.kind === "devwidget") return "warm";
  return TILE_META[tile.kind].defaultLifecycle;
}
