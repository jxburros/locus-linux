/*
 * Tile metadata — the pure-data half of the tile registry.
 * ---------------------------------------------------------------------------
 * Geometry, class (Anchor vs Widget), naming, and focus routing for every
 * built-in tile kind. Kept free of components so the desktop store can import
 * it; the component map lives in components/tiles/registry.tsx.
 *
 * Coordinates are dense workspace units: the surface is GRID_W × GRID_H units
 * and always projects into the available viewport, so placement feels nearly
 * freeform while snapping keeps it precise. (The legacy model was 12 coarse
 * columns; one legacy cell = V1_UNIT_FACTOR units.)
 */

import type { AppId, BuiltinTileKind, SizeClass, TileClass, TileMode } from "@/types";

/** The workspace is a fixed, non-scrolling surface of GRID_W × GRID_H units. */
export const GRID_W = 96;
export const GRID_H = 54;

/**
 * The absolute floor for any placed tile (issue #9): every tile — every app —
 * can be sized very small. Presentation modes (full → compact → mini → icon)
 * absorb the loss of room, so a tile at the floor is just an icon.
 */
export const MIN_TILE_W = 4;
export const MIN_TILE_H = 3;

/** One cell of the legacy 12-column grid, expressed in dense units. */
export const V1_UNIT_FACTOR = 8;

export interface TileMeta {
  kind: BuiltinTileKind;
  name: string;
  /** Short monospace mark used wherever the tile is listed. */
  icon: string;
  tileClass: TileClass;
  description: string;
  minW: number;
  minH: number;
  defW: number;
  defH: number;
  /**
   * When focusing this tile should open a full registry app instead of the
   * tile's own large view.
   */
  focusApp?: AppId;
  /** Default lifecycle when the user has not chosen one (spec §20). */
  defaultLifecycle: "live" | "warm";
  /** Render without the standard tile header — the content is its own chrome. */
  chromeless?: boolean;
  keywords: string[];
}

export const TILE_META: Record<BuiltinTileKind, TileMeta> = {
  home: {
    kind: "home",
    name: "Home",
    icon: "⌂",
    tileClass: "widget",
    description:
      "The Locus mark, mode, search, status and time — chrome as a tile. The logo always returns to the Dashboard.",
    minW: 8, minH: 3, defW: GRID_W, defH: 4,
    defaultLifecycle: "live",
    chromeless: true,
    keywords: ["home", "logo", "locus", "bar", "header", "status", "search", "navigation", "dashboard"],
  },
  assistant: {
    kind: "assistant",
    name: "AI Assistant",
    icon: "◐",
    tileClass: "widget",
    description: "Your named assistant — ask, inspect context, approve changes.",
    minW: 16, minH: 8, defW: 32, defH: 24,
    focusApp: "assistant",
    defaultLifecycle: "warm",
    keywords: ["ai", "chat", "model", "milo", "ask"],
  },
  taskmanager: {
    kind: "taskmanager",
    name: "Task Manager",
    icon: "▦",
    tileClass: "widget",
    description: "System resources and processes — what is running and why.",
    minW: 16, minH: 8, defW: 32, defH: 24,
    defaultLifecycle: "live",
    keywords: ["system", "monitor", "cpu", "memory", "processes", "performance"],
  },
  todo: {
    kind: "todo",
    name: "To-do",
    icon: "☑",
    tileClass: "widget",
    description: "A quick list for lightweight items.",
    minW: 16, minH: 8, defW: 24, defH: 24,
    defaultLifecycle: "warm",
    keywords: ["todo", "list", "check", "quick"],
  },
  files: {
    kind: "files",
    name: "Files",
    icon: "▚",
    tileClass: "widget",
    description: "Local-first file browsing — recents small, browser large.",
    minW: 16, minH: 8, defW: 24, defH: 24,
    focusApp: "files",
    defaultLifecycle: "warm",
    keywords: ["files", "folders", "recent", "browser"],
  },
  weather: {
    kind: "weather",
    name: "Weather",
    icon: "☁",
    tileClass: "anchor",
    description: "A display-oriented weather Anchor.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["weather", "forecast", "temperature"],
  },
  workspaces: {
    kind: "workspaces",
    name: "Workspaces",
    icon: "◫",
    tileClass: "widget",
    description: "Switch between named saved layouts.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["workspaces", "layouts", "switch", "rooms"],
  },
  apps: {
    kind: "apps",
    name: "Apps",
    icon: "⊞",
    tileClass: "widget",
    description: "Launcher for apps, widgets, and anchors — drag tiles out from here.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["apps", "launcher", "add", "widgets", "anchors"],
  },
  music: {
    kind: "music",
    name: "Music",
    icon: "♪",
    tileClass: "widget",
    description: "Playback and now-playing.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["music", "player", "now playing", "queue"],
  },
  notifications: {
    kind: "notifications",
    name: "Notifications",
    icon: "◍",
    tileClass: "anchor",
    description: "System and app notifications.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["notifications", "alerts", "inbox"],
  },
  notes: {
    kind: "notes",
    name: "Notes",
    icon: "≡",
    tileClass: "widget",
    description: "A quick note that is always where you left it.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["notes", "scratch", "text", "jot"],
  },
  photo: {
    kind: "photo",
    name: "Photo",
    icon: "▣",
    tileClass: "anchor",
    description: "A static custom image. Personal visual customization matters.",
    minW: 8, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["photo", "image", "picture", "custom"],
  },
  clock: {
    kind: "clock",
    name: "Clock",
    icon: "◔",
    tileClass: "anchor",
    description: "Time and date.",
    minW: 8, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "live",
    keywords: ["clock", "time", "date"],
  },
  battery: {
    kind: "battery",
    name: "Battery",
    icon: "▮",
    tileClass: "anchor",
    description: "Battery, power, and performance mode.",
    minW: 8, minH: 8, defW: 24, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["battery", "power", "charging", "energy"],
  },
  settings: {
    kind: "settings",
    name: "Settings",
    icon: "⚙",
    tileClass: "widget",
    description: "Quick controls, with full system settings in Focus.",
    minW: 16, minH: 8, defW: 24, defH: 16,
    focusApp: "settings",
    defaultLifecycle: "warm",
    keywords: ["settings", "preferences", "theme", "controls"],
  },
  scratchpad: {
    kind: "scratchpad",
    name: "Scratchpad",
    icon: "▤",
    tileClass: "widget",
    description: "The holding tank — what you need now but have not placed.",
    minW: 16, minH: 8, defW: 48, defH: 16,
    defaultLifecycle: "warm",
    keywords: ["scratchpad", "holding", "on deck", "staging"],
  },
};

export const BUILTIN_TILE_KINDS = Object.keys(TILE_META) as BuiltinTileKind[];

/**
 * Default geometry for a "devwidget" tile — a placed Dev Core widget
 * artifact. Not a TILE_META entry: devwidget is one kind standing in for
 * many possible artifacts, each supplying its own name/icon from its
 * manifest (core/desktop.ts's tileName/tileIcon), not from static metadata.
 */
export const DEVWIDGET_DEFAULTS = { minW: 8, minH: 6, defW: 16, defH: 12 };

/**
 * Derive the content density from a tile's *unit* footprint. Used where pixels
 * are not known (stacked mobile layout, previews). The spatial renderer uses
 * modeForPx instead, because compression changes pixels at constant units.
 */
export function sizeClassFor(w: number, h: number): SizeClass {
  const area = w * h;
  if (area <= 192 || h <= 8) return "tiny";
  if (area <= 512) return "small";
  if (area <= 1280) return "medium";
  return "large";
}

/**
 * Presentation mode from rendered pixels (change brief §10): tiles keep their
 * identity as the workspace compresses — full → compact → mini → icon.
 * Strip-shaped tiles (edge bars) are judged by area so a 1400×60 bar is not
 * mistaken for an icon.
 */
export function modeForPx(w: number, h: number): TileMode {
  const minDim = Math.min(w, h);
  const area = w * h;
  if (minDim < 40 || area < 4600) return "icon";
  if (minDim < 68 || area < 16000) return "mini";
  if (minDim < 104 || area < 46000) return "compact";
  return "full";
}

/** The content density a presentation mode implies (mini/icon render no body). */
export function contentSizeForMode(mode: TileMode, wPx: number, hPx: number): SizeClass {
  if (mode === "full") return wPx >= 460 && hPx >= 300 ? "large" : "medium";
  if (mode === "compact") return "small";
  return "tiny";
}
