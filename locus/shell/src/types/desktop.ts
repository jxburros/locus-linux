/*
 * The placed-tile desktop model (Locus_Desktop_Design.md + the spatial
 * workspace change brief).
 * ---------------------------------------------------------------------------
 * Everything visible is a Tile placed on a dense unit surface. There are no
 * floating windows. Tiles are either Anchors (display) or Widgets (do). The
 * desktop has three layout modes — Dashboard, Focus, Freeform — plus named
 * saved Workspaces, and a Scratchpad that holds active-but-unplaced tiles.
 *
 * Coordinates are dense workspace units (see core/tileMeta.ts GRID_W/GRID_H),
 * not coarse columns: placement feels nearly freeform, snapping keeps it
 * precise. The surface never scrolls — units project into whatever pixels the
 * viewport provides.
 */

import type { AppId } from "./app";

/** Built-in tile kinds (spec §13). Registry apps are placed via kind "app". */
export type BuiltinTileKind =
  | "home"
  | "assistant"
  | "taskmanager"
  | "todo"
  | "files"
  | "weather"
  | "workspaces"
  | "apps"
  | "music"
  | "notifications"
  | "notes"
  | "photo"
  | "clock"
  | "battery"
  | "settings"
  | "scratchpad";

/** "gap" is a deliberately held empty space — an empty Anchor reserving room.
    "devwidget" places an installed Dev Core widget artifact (see
    `settings.artifactId` on TileInstance below) as a sandboxed tile. */
export type TileKind = BuiltinTileKind | "app" | "gap" | "devwidget";

/** Anchors display. Widgets do. Same tile system, different intent. */
export type TileClass = "anchor" | "widget";

/** Content density passed to tile components (kept from the placed-tile spec). */
export type SizeClass = "tiny" | "small" | "medium" | "large";

/**
 * Presentation mode, derived from a tile's *rendered pixel* size — not its
 * unit footprint. The same tile can be full on a monitor and icon-sized when
 * the workspace compresses around a focused tile or a small window.
 */
export type TileMode = "full" | "compact" | "mini" | "icon";

/** A workspace edge a persistent widget can attach to. */
export type EdgeSide = "top" | "bottom" | "left" | "right";

/** One side of a tile, for any-side resizing (issue #11). */
export type ResizeSide = "n" | "e" | "s" | "w";

/** A resize grip: one side or one corner. */
export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * The header's own, much simpler widget system (issue #6). A header segment
 * (a "home" edge widget) renders an ordered list of these items. The required
 * kinds — logo, mode switcher, freeform, apps, settings — can be moved between
 * segments but never removed entirely, so the user can always find their way
 * back to every mode and surface. Everything else is add/move/removable.
 */
export type HeaderItemKind =
  | "logo" //          required: the mark; always returns to the Dashboard
  | "mode" //          required: Dashboard ↔ Focus switcher
  | "freeform" //      required: enter Freeform; hosts the Freeform controls
  | "apps" //          required: open the Apps tile
  | "settings" //      required: open the Settings tile
  | "spacer"
  | "workspace" //     current workspace name + saved feedback
  | "shuffle" //       shuffle + repack the current tiles (issue #8)
  | "search" //        command palette
  | "ai"
  | "notifications"
  | "battery"
  | "clock"
  | "scratchpad";

export interface HeaderItem {
  id: string;
  kind: HeaderItemKind;
}

/** The header item kinds that must always exist somewhere across segments. */
export const REQUIRED_HEADER_KINDS: HeaderItemKind[] = [
  "logo",
  "mode",
  "freeform",
  "apps",
  "settings",
];

/**
 * Tile lifecycle (spec §20). "live"/"warm"/"sleeping" are user- or
 * system-settable performance states; "setup"/"error" are content states a
 * tile reports about itself.
 */
export type TileLifecycle = "live" | "warm" | "snapshot" | "sleeping" | "setup" | "error";

/** One placed (or held) tile. Position and size are dense workspace units. */
export interface TileInstance {
  id: string;
  kind: TileKind;
  /** The registry app behind this tile, when kind === "app". */
  app?: AppId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** User-chosen display name (defaults to the kind's name). */
  title?: string;
  /** Draw the accent highlight on this tile's header. */
  accent?: boolean;
  /** Whether the AI may consider this tile part of visible context. */
  aiVisible?: boolean;
  /** User-set performance preference. Default is per-kind. */
  lifecycle?: "live" | "warm" | "sleeping";
  /**
   * Persistent edge widget: appears across Dashboard, Workspaces and Focus,
   * and reserves a band of the surface for itself. Chrome made from tiles.
   */
  persistent?: boolean;
  /** Which edge a persistent widget is attached to. */
  edge?: EdgeSide;
  /** Per-kind configuration (weather location, photo image, clock format…).
      For kind "devwidget": `artifactId` (string) — the installed Dev Core
      widget artifact this tile renders. */
  settings?: Record<string, unknown>;
}

/** A named arrangement. The Dashboard is layout id "dashboard"; the rest are Workspaces. */
export interface DesktopLayout {
  id: string;
  name: string;
  tiles: TileInstance[];
  /** Ships with the system (the Dashboard) — resettable, not deletable. */
  builtIn?: boolean;
  /** Optional per-workspace accent, applied when the workspace opens. */
  accent?: string;
  /** When true this workspace keeps its own Scratchpad. */
  ownScratchpad?: boolean;
  /** Apps whose context the AI may read while this layout is active. */
  aiContextScope?: AppId[];
}

/** Scratchpad entry: a tile held "on deck" — active, but not placed. */
export interface ScratchItem {
  id: string;
  tile: TileInstance;
  pinned: boolean;
  addedAt: number;
  lastUsed: number;
  activity: "active" | "warm" | "paused";
}

export type DesktopMode = "dashboard" | "focus" | "freeform";

/** What the Focus View's large slot is showing. */
export interface FocusTarget {
  /** A placed tile in the current arrangement… */
  tileId?: string;
  /** …or a detached tile (opened from Scratchpad, the Apps launcher, or the palette). */
  tile?: TileInstance;
  /** Set when the detached tile came from the Scratchpad. */
  scratchId?: string;
  /**
   * An empty Focus: the large slot is just space (issue #6 — switching to
   * Focus with no prior focused app shows empty space, not a forced pick).
   */
  empty?: boolean;
}

export interface DropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What would happen if the dragged tile were dropped here (spec §11). */
export type DropPlan =
  | { kind: "move"; rect: DropRect }
  | { kind: "replace"; rect: DropRect; targetId: string }
  | { kind: "nudge"; rect: DropRect; moves: { id: string; x: number; y: number }[] }
  | { kind: "fill-gap"; rect: DropRect; gapId: string }
  | { kind: "scratchpad"; rect: DropRect }
  | { kind: "invalid"; rect: DropRect };
