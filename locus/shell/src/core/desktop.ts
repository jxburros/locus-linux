/*
 * The desktop store — placed tiles, modes, workspaces, scratchpad, widgets.
 * ---------------------------------------------------------------------------
 * Implements the saved-change rules from the design spec exactly:
 *   Dashboard / Workspace  → layout changes are saved by default.
 *   Focus                  → content saves (apps own it); Focus is a projection
 *                            of the current arrangement (the focused tile
 *                            grows, the rest compress); entering/leaving never
 *                            resizes the underlying layout.
 *   Freeform               → changes are NOT saved by default; the user exits
 *                            by discarding, applying, or saving a Workspace.
 *
 * Coordinates are dense workspace units on a fixed GRID_W × GRID_H surface
 * (change brief §1, §9). The surface never reflows globally: moving or
 * inserting a tile affects only the tiles directly involved. Gaps are just
 * background; a deliberately held gap is a "gap" tile.
 *
 * Persistent edge widgets (brief §8) are chrome made from tiles: they live in
 * state.widgets — not in any layout — appear across every view, and reserve
 * an edge band that shrinks the usable area for placed tiles.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";
import { deliver } from "./cores/notification";
import {
  GRID_W,
  GRID_H,
  MIN_TILE_W,
  MIN_TILE_H,
  V1_UNIT_FACTOR,
  TILE_META,
  DEVWIDGET_DEFAULTS,
  sizeClassFor,
} from "./tileMeta";
import { fitToSurface, nearestEdge, widgetThickness } from "./surface";
import { getApp } from "./appRegistry";
import { getArtifact as getDevArtifact } from "./cores/dev";
import type {
  AppId,
  BuiltinTileKind,
  DesktopLayout,
  DesktopMode,
  DropPlan,
  DropRect,
  EdgeSide,
  FocusTarget,
  HeaderItem,
  HeaderItemKind,
  ResizeEdge,
  ResizeSide,
  ScratchItem,
  TileInstance,
  TileKind,
} from "@/types";
import { REQUIRED_HEADER_KINDS } from "@/types";

export { GRID_W, GRID_H, MIN_TILE_W, MIN_TILE_H, sizeClassFor };

/* ------------------------------- state shape ------------------------------ */

interface FreeformSession {
  /** The layout Freeform started from. */
  baseId: string;
  /** The working copy — every Freeform edit lands here, never in the base. */
  draft: DesktopLayout;
  /** Tiles added during this session (candidates for "move to Scratchpad"). */
  addedIds: string[];
}

export interface DesktopState {
  layouts: DesktopLayout[]; // [0] is always the Dashboard
  activeLayoutId: string;
  /** Persistent edge widgets — global, rendered across every view. */
  widgets: TileInstance[];
  scratch: Record<string, ScratchItem[]>; // "global" + per-workspace pools
  freeform: FreeformSession | null;
  focus: FocusTarget | null;
  /**
   * What Focus last showed, so the header's Dashboard ↔ Focus switcher can
   * lean back into it (issue #6). Holds a detached snapshot as a fallback for
   * when the placed tile no longer exists.
   */
  lastFocus: FocusTarget | null;
  lowPower: boolean;
  /** Coordinate-system version; v1 was the coarse 12-column grid. */
  coordsVersion: number;
}

const DASHBOARD_ID = "dashboard";
const GLOBAL_SCRATCH = "global";
const COORDS_VERSION = 2;

let seq = 0;
function tid(prefix = "t"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/* ------------------------------ tile factory ------------------------------ */

const CUSTOM_TILE_KINDS = new Set<TileKind>(["app", "gap", "devwidget"]);

export function makeTile(
  kind: TileKind,
  pos: Partial<DropRect> = {},
  extra: Partial<TileInstance> = {},
): TileInstance {
  const meta = !CUSTOM_TILE_KINDS.has(kind) ? TILE_META[kind as BuiltinTileKind] : null;
  const appMeta = kind === "app" && extra.app ? getApp(extra.app) : null;
  const appW = appMeta?.anchor?.defaultSpan ? appMeta.anchor.defaultSpan.col * 24 : 24;
  const defW = kind === "devwidget" ? DEVWIDGET_DEFAULTS.defW : appW;
  const defH = kind === "devwidget" ? DEVWIDGET_DEFAULTS.defH : 16;
  return {
    id: tid(),
    kind,
    x: pos.x ?? 0,
    y: pos.y ?? 0,
    w: pos.w ?? meta?.defW ?? defW,
    h: pos.h ?? meta?.defH ?? defH,
    aiVisible: true,
    ...extra,
  };
}

export function tileName(t: TileInstance): string {
  if (t.title) return t.title;
  if (t.kind === "app") return getApp(t.app as AppId)?.name ?? "App";
  if (t.kind === "gap") return "Held space";
  if (t.kind === "devwidget") {
    const artifactId = t.settings?.artifactId as string | undefined;
    const artifact = artifactId ? getDevArtifact(artifactId) : undefined;
    return artifact?.manifest.name ?? "Dev widget";
  }
  return TILE_META[t.kind].name;
}

export function tileIcon(t: TileInstance): string {
  if (t.kind === "app") return getApp(t.app as AppId)?.icon ?? "◦";
  if (t.kind === "gap") return "▢";
  if (t.kind === "devwidget") return "▧";
  return TILE_META[t.kind].icon;
}

export function tileMinSize(t: TileInstance): { w: number; h: number } {
  // Issue #9: every tile — every app — can be sized very small. Presentation
  // modes (full → compact → mini → icon) absorb the loss of room.
  void t;
  return { w: MIN_TILE_W, h: MIN_TILE_H };
}

/* ------------------------- first-run default layout ------------------------ */
/* Spec §23 tiles, laid out to cover the full surface with shared borders:
   deliberate spaces are the user's to make (change brief §2). The Home widget
   is not part of the layout — it is a persistent edge widget. */

export function defaultDashboard(): DesktopLayout {
  const t = (kind: TileKind, x: number, y: number, w: number, h: number) =>
    makeTile(kind, { x, y, w, h });
  return {
    id: DASHBOARD_ID,
    name: "Dashboard",
    builtIn: true,
    tiles: [
      t("clock", 0, 0, 24, 18),
      t("assistant", 24, 0, 48, 36),
      t("battery", 72, 0, 24, 18),
      t("files", 0, 18, 24, 18),
      t("apps", 72, 18, 24, 18),
      t("todo", 0, 36, 24, 18),
      t("scratchpad", 24, 36, 48, 18),
      t("settings", 72, 36, 24, 18),
    ],
    aiContextScope: ["tasks", "files", "writer", "cards"],
  };
}

/* --------------------------------- header ---------------------------------- */
/* The header is one or more "home" edge widgets — segments — each rendering an
   ordered list of HeaderItems (issue #6). Segments can sit on any edge, even
   several edges at once (issue #10). The required items (logo, mode switcher,
   Freeform, Apps, Settings) can move between segments but the last instance of
   each can never be deleted, so every mode and surface stays reachable. */

let hseq = 0;
function hid(): string {
  hseq += 1;
  return `h-${Date.now().toString(36)}-${hseq.toString(36)}`;
}

export function defaultHeaderItems(): HeaderItem[] {
  const kinds: HeaderItemKind[] = [
    "logo",
    "mode",
    "workspace",
    "spacer",
    "freeform",
    "shuffle",
    "search",
    "ai",
    "notifications",
    "battery",
    "clock",
    "apps",
    "settings",
  ];
  return kinds.map((kind) => ({ id: hid(), kind }));
}

/** The items a header segment renders (stored on the widget, defaulted once). */
export function headerItems(segment: TileInstance): HeaderItem[] {
  const items = segment.settings?.headerItems as HeaderItem[] | undefined;
  return Array.isArray(items) ? items : defaultHeaderItems();
}

/** All header segments (home widgets), in edge-band order. */
export function headerSegments(): TileInstance[] {
  return load().widgets.filter((w) => w.kind === "home");
}

function headerKindCount(kind: HeaderItemKind): number {
  return headerSegments().reduce(
    (sum, seg) => sum + headerItems(seg).filter((i) => i.kind === kind).length,
    0,
  );
}

/** Required items are only locked when they are the last of their kind. */
export function canRemoveHeaderItem(item: HeaderItem): boolean {
  if (!REQUIRED_HEADER_KINDS.includes(item.kind)) return true;
  return headerKindCount(item.kind) > 1;
}

function setHeaderItems(segmentId: string, items: HeaderItem[]): void {
  mutateWidgets((ws) =>
    ws.map((w) =>
      w.id === segmentId ? { ...w, settings: { ...(w.settings ?? {}), headerItems: items } } : w,
    ),
  );
}

export function addHeaderItem(segmentId: string, kind: HeaderItemKind): void {
  const seg = headerSegments().find((s) => s.id === segmentId);
  if (!seg) return;
  setHeaderItems(segmentId, [...headerItems(seg), { id: hid(), kind }]);
}

export function removeHeaderItem(segmentId: string, itemId: string): void {
  const seg = headerSegments().find((s) => s.id === segmentId);
  if (!seg) return;
  const item = headerItems(seg).find((i) => i.id === itemId);
  if (!item) return;
  if (!canRemoveHeaderItem(item)) {
    deliver({
      title: "That control has to live somewhere",
      detail: "It is the last of its kind in the header — add another copy first, then remove this one.",
      source: "Header",
    });
    return;
  }
  setHeaderItems(segmentId, headerItems(seg).filter((i) => i.id !== itemId));
}

export function moveHeaderItem(segmentId: string, itemId: string, dir: -1 | 1): void {
  const seg = headerSegments().find((s) => s.id === segmentId);
  if (!seg) return;
  const items = [...headerItems(seg)];
  const i = items.findIndex((x) => x.id === itemId);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  setHeaderItems(segmentId, items);
}

/** Add another header segment on any edge (issue #10 — even multiple edges). */
export function addHeaderSegment(edge: EdgeSide): TileInstance {
  const horizontal = edge === "top" || edge === "bottom";
  const seg = makeTile(
    "home",
    horizontal
      ? { x: 0, y: edge === "top" ? 0 : GRID_H - 4, w: GRID_W, h: 4 }
      : { x: edge === "left" ? 0 : GRID_W - 8, y: 0, w: 8, h: GRID_H },
    {
      persistent: true,
      edge,
      lifecycle: "live",
      settings: {
        headerItems: (["logo", "spacer", "clock"] as HeaderItemKind[]).map((kind) => ({
          id: hid(),
          kind,
        })),
      },
    },
  );
  mutateWidgets((ws) => [...ws, seg]);
  record({ type: "system.event", summary: `Added a header segment on the ${edge} edge` });
  return seg;
}

/**
 * Removing or unpinning a header segment must never strand the user: the
 * required controls have to survive somewhere in the remaining header.
 */
function headerCoversRequiredWithout(segmentId: string): boolean {
  const rest = headerSegments().filter((s) => s.id !== segmentId);
  return REQUIRED_HEADER_KINDS.every((kind) =>
    rest.some((seg) => headerItems(seg).some((i) => i.kind === kind)),
  );
}

function defaultHomeWidget(): TileInstance {
  return makeTile(
    "home",
    { x: 0, y: 0, w: GRID_W, h: 4 },
    {
      persistent: true,
      edge: "top",
      lifecycle: "live",
      settings: { headerItems: defaultHeaderItems() },
    },
  );
}

/* ------------------------------- persistence ------------------------------ */

let cache: DesktopState | null = null;

function defaults(): DesktopState {
  return {
    layouts: [defaultDashboard()],
    activeLayoutId: DASHBOARD_ID,
    widgets: [defaultHomeWidget()],
    scratch: { [GLOBAL_SCRATCH]: [] },
    freeform: null,
    focus: null,
    lastFocus: null,
    lowPower: false,
    coordsVersion: COORDS_VERSION,
  };
}

/* ------------------------------- migration --------------------------------- */
/* v1 stored coarse 12-column coordinates on an unbounded, scrolling canvas.
   v2 is the dense fixed surface. One legacy cell = V1_UNIT_FACTOR units;
   layouts taller than the surface are scaled (endpoint-wise, so adjacency
   survives) to fit. Persistent widgets did not exist in v1 — the migration
   introduces the Home widget so removed chrome keeps a home. */

function migrateState(stored: Partial<DesktopState>): DesktopState {
  const base = defaults();
  let s: DesktopState = {
    ...base,
    ...stored,
    widgets: Array.isArray(stored.widgets) ? stored.widgets : base.widgets,
    coordsVersion: stored.coordsVersion ?? 1,
  };
  if (s.coordsVersion >= COORDS_VERSION) return s;

  const scaleTile = (t: TileInstance): TileInstance => ({
    ...t,
    x: t.x * V1_UNIT_FACTOR,
    y: t.y * V1_UNIT_FACTOR,
    w: Math.max(1, t.w) * V1_UNIT_FACTOR,
    h: Math.max(1, t.h) * V1_UNIT_FACTOR,
  });
  const scaleLayout = (l: DesktopLayout): DesktopLayout => ({
    ...l,
    tiles: fitToSurface(l.tiles.map(scaleTile)),
  });

  const scratch: Record<string, ScratchItem[]> = {};
  for (const [key, items] of Object.entries(s.scratch ?? {})) {
    scratch[key] = (items ?? []).map((i) => ({ ...i, tile: scaleTile(i.tile) }));
  }

  s = {
    ...s,
    layouts: s.layouts.map(scaleLayout),
    scratch,
    freeform: s.freeform
      ? { ...s.freeform, draft: scaleLayout(s.freeform.draft) }
      : null,
    focus: s.focus?.tile ? { ...s.focus, tile: scaleTile(s.focus.tile) } : s.focus,
    widgets: Array.isArray(stored.widgets) ? s.widgets : [defaultHomeWidget()],
    coordsVersion: COORDS_VERSION,
  };
  record({
    type: "system.event",
    summary: "Workspace upgraded to the dense spatial surface",
    detail: "Your layouts were carried over onto the new fixed workspace.",
  });
  return s;
}

function load(): DesktopState {
  if (cache) return cache;
  const stored = storage.get<Partial<DesktopState> | null>(StoreKeys.desktop, null);
  if (stored && Array.isArray(stored.layouts) && stored.layouts.length) {
    cache = migrateState(stored);
    if ((stored.coordsVersion ?? 1) < COORDS_VERSION) storage.set(StoreKeys.desktop, cache);
  } else {
    cache = defaults();
    storage.set(StoreKeys.desktop, cache);
  }
  return cache;
}

function save(next: DesktopState): void {
  cache = next;
  storage.set(StoreKeys.desktop, next);
}

export function getDesktop(): DesktopState {
  return load();
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.desktop, () => {
    // Re-hydrate on cross-tab writes; local writes already updated the cache.
    if (storage.get<DesktopState | null>(StoreKeys.desktop, null) !== null && cache === null) load();
    fn();
  });
}

/** Invalidate + notify (cross-tab writes come through storage events). */
function commit(next: DesktopState): void {
  save(next);
}

/* --------------------------- saved-change feedback ------------------------- */
/* Spec §15: in Dashboard/Workspace the system shows subtle "Saved" feedback;
   in Freeform it must show that changes are temporary. */

let savedAt = 0;
const savedListeners = new Set<() => void>();
function flashSaved(): void {
  savedAt = Date.now();
  savedListeners.forEach((fn) => fn());
}
export function getSavedAt(): number {
  return savedAt;
}
export function subscribeSaved(fn: () => void): () => void {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}

/* -------------------------------- selectors -------------------------------- */

export function getMode(): DesktopMode {
  const s = load();
  if (s.focus) return "focus";
  if (s.freeform) return "freeform";
  return "dashboard";
}

export function getActiveLayout(): DesktopLayout {
  const s = load();
  return s.layouts.find((l) => l.id === s.activeLayoutId) ?? s.layouts[0];
}

/** The arrangement currently on screen: the Freeform draft when active. */
export function getCurrentArrangement(): DesktopLayout {
  const s = load();
  return s.freeform ? s.freeform.draft : getActiveLayout();
}

export function getWorkspaces(): DesktopLayout[] {
  return load().layouts.filter((l) => l.id !== DASHBOARD_ID);
}

export function isDashboardActive(): boolean {
  return load().activeLayoutId === DASHBOARD_ID;
}

/** Persistent edge widgets — chrome as tiles, visible across every view. */
export function getWidgets(): TileInstance[] {
  return load().widgets;
}

function scratchKey(s: DesktopState): string {
  const layout = s.layouts.find((l) => l.id === s.activeLayoutId);
  return layout?.ownScratchpad ? layout.id : GLOBAL_SCRATCH;
}

export function getScratchpad(): ScratchItem[] {
  const s = load();
  return s.scratch[scratchKey(s)] ?? [];
}

export function getFocus(): FocusTarget | null {
  return load().focus;
}

/** Resolve the focused tile instance, wherever it lives. */
export function getFocusedTile(): TileInstance | null {
  const s = load();
  if (!s.focus) return null;
  if (s.focus.tile) return s.focus.tile;
  if (s.focus.tileId) {
    return getCurrentArrangement().tiles.find((t) => t.id === s.focus!.tileId) ?? null;
  }
  return null;
}

export function getLowPower(): boolean {
  return load().lowPower;
}

/* ----------------------------- layout mutation ----------------------------- */
/*
 * Every tile mutation goes through here. In Freeform it edits the draft (not
 * saved to the source); otherwise it edits the active layout and persists —
 * which *is* the "saved by default" rule.
 */
function mutateTiles(fn: (tiles: TileInstance[]) => TileInstance[]): void {
  const s = load();
  if (s.freeform) {
    const draft = { ...s.freeform.draft, tiles: fn(s.freeform.draft.tiles) };
    commit({ ...s, freeform: { ...s.freeform, draft } });
  } else {
    const layouts = s.layouts.map((l) =>
      l.id === s.activeLayoutId ? { ...l, tiles: fn(l.tiles) } : l,
    );
    commit({ ...s, layouts });
    flashSaved();
  }
}

function mutateScratch(fn: (items: ScratchItem[]) => ScratchItem[]): void {
  const s = load();
  const key = scratchKey(s);
  commit({ ...s, scratch: { ...s.scratch, [key]: fn(s.scratch[key] ?? []) } });
}

function mutateWidgets(fn: (widgets: TileInstance[]) => TileInstance[]): void {
  const s = load();
  commit({ ...s, widgets: fn(s.widgets) });
  flashSaved();
}

/* ------------------------------ geometry ---------------------------------- */

export function rectsOverlap(a: DropRect, b: DropRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapArea(a: DropRect, b: DropRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function clampRect(rect: DropRect): DropRect {
  const w = Math.max(MIN_TILE_W, Math.min(rect.w, GRID_W));
  const h = Math.max(MIN_TILE_H, Math.min(rect.h, GRID_H));
  return {
    w,
    h,
    x: Math.max(0, Math.min(rect.x, GRID_W - w)),
    y: Math.max(0, Math.min(rect.y, GRID_H - h)),
  };
}

function collides(rect: DropRect, tiles: TileInstance[], ignore: Set<string>): boolean {
  return tiles.some((t) => !ignore.has(t.id) && rectsOverlap(rect, t));
}

/** First free spot scanning left-to-right, top-to-bottom; null when full. */
function findFreeSpotStrict(
  tiles: TileInstance[],
  w: number,
  h: number,
): { x: number; y: number } | null {
  w = Math.min(w, GRID_W);
  h = Math.min(h, GRID_H);
  for (const step of [2, 1]) {
    for (let y = 0; y + h <= GRID_H; y += step) {
      for (let x = 0; x + w <= GRID_W; x += step) {
        if (!collides({ x, y, w, h }, tiles, new Set())) return { x, y };
      }
    }
  }
  return null;
}

/**
 * First free spot for a w×h tile. When the surface is genuinely full the
 * caller should use placeInto() instead — placement must always succeed by
 * making room (issue #9); this fallback only centers as a last resort.
 */
export function findFreeSpot(tiles: TileInstance[], w: number, h: number): { x: number; y: number } {
  return (
    findFreeSpotStrict(tiles, w, h) ?? {
      x: Math.round((GRID_W - Math.min(w, GRID_W)) / 2),
      y: Math.round((GRID_H - Math.min(h, GRID_H)) / 2),
    }
  );
}

/**
 * Repack a tile set into a gapless mosaic covering the whole surface: rows of
 * near-equal height, widths in proportion to each tile's former width, all
 * endpoint-rounded so every border is shared. Held gaps dissolve — the point
 * of packing is that there are no gaps (issue #8).
 */
export function packTiles(list: TileInstance[]): TileInstance[] {
  const real = list.filter((t) => t.kind !== "gap");
  const n = real.length;
  if (n === 0) return [];
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * GRID_W) / GRID_H / 1.6)) || 1));
  const rows = Math.ceil(n / cols);
  const counts: number[] = [];
  let rem = n;
  for (let r = rows; r > 0; r--) {
    const c = Math.ceil(rem / r);
    counts.push(c);
    rem -= c;
  }
  const out: TileInstance[] = [];
  let idx = 0;
  counts.forEach((count, r) => {
    const y1 = Math.round((r * GRID_H) / rows);
    const y2 = Math.round(((r + 1) * GRID_H) / rows);
    const rowTiles = real.slice(idx, idx + count);
    const totalW = rowTiles.reduce((s, t) => s + Math.max(MIN_TILE_W, t.w), 0);
    let acc = 0;
    for (const t of rowTiles) {
      const x1 = Math.round((acc / totalW) * GRID_W);
      acc += Math.max(MIN_TILE_W, t.w);
      const x2 = Math.round((acc / totalW) * GRID_W);
      out.push({ ...t, x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) });
    }
    idx += count;
  });
  return out;
}

/**
 * Shuffle: rearrange and resize every current tile so the surface is covered
 * with no gaps (issue #8). Order is randomized; sizes stay proportional.
 */
export function shuffleTiles(): void {
  const tiles = getCurrentArrangement().tiles.filter((t) => t.kind !== "gap");
  if (tiles.length === 0) return;
  const order = [...tiles];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  mutateTiles(() => packTiles(order));
  record({ type: "system.event", summary: "Shuffled the workspace — tiles repacked with no gaps" });
}

/**
 * Place a tile so that placement ALWAYS succeeds (issue #9): try a free spot
 * at its native size, then progressively smaller down to the floor, then fill
 * a held gap, and finally make room — every tile moves and resizes into a
 * gapless repack that includes the newcomer.
 */
function placeInto(tiles: TileInstance[], tile: TileInstance): TileInstance[] {
  const steps: [number, number][] = [
    [tile.w, tile.h],
    [Math.max(MIN_TILE_W, Math.round(tile.w * 0.75)), Math.max(MIN_TILE_H, Math.round(tile.h * 0.75))],
    [Math.max(MIN_TILE_W, Math.round(tile.w / 2)), Math.max(MIN_TILE_H, Math.round(tile.h / 2))],
    [MIN_TILE_W, MIN_TILE_H],
  ];
  for (const [w, h] of steps) {
    const spot = findFreeSpotStrict(tiles, w, h);
    if (spot) return [...tiles, { ...tile, ...spot, w, h }];
  }
  const gaps = tiles
    .filter((t) => t.kind === "gap")
    .sort((a, b) => b.w * b.h - a.w * a.h);
  if (gaps.length > 0) {
    const g = gaps[0];
    return [
      ...tiles.filter((t) => t.id !== g.id),
      { ...tile, x: g.x, y: g.y, w: g.w, h: g.h },
    ];
  }
  return packTiles([...tiles, tile]);
}

/**
 * Decide what a drop at `rect` means (spec §11):
 *  - empty space → occupy it;
 *  - mostly over one tile → replace it (clearly indicated, never accidental);
 *  - mostly over a held gap → fill it;
 *  - partially over neighbors → nudge only those tiles, locally;
 *  - otherwise → invalid.
 */
export function planDrop(
  tiles: TileInstance[],
  rawRect: DropRect,
  dragId: string | null,
): DropPlan {
  const rect = clampRect(rawRect);
  const others = tiles.filter((t) => t.id !== dragId);
  const hits = others
    .map((t) => ({ t, area: overlapArea(rect, t) }))
    .filter((x) => x.area > 0)
    .sort((a, b) => b.area - a.area);

  if (hits.length === 0) return { kind: "move", rect };

  const top = hits[0];
  const ratio = top.area / Math.min(rect.w * rect.h, top.t.w * top.t.h);

  if (top.t.kind === "gap" && ratio >= 0.4) {
    return {
      kind: "fill-gap",
      gapId: top.t.id,
      rect: { x: top.t.x, y: top.t.y, w: top.t.w, h: top.t.h },
    };
  }

  if (hits.length === 1 && ratio >= 0.55) {
    return {
      kind: "replace",
      targetId: top.t.id,
      rect: { x: top.t.x, y: top.t.y, w: top.t.w, h: top.t.h },
    };
  }

  // Insert between: only the overlapped tiles make room; nothing else moves.
  const still = others.filter((t) => !hits.some((h) => h.t.id === t.id));
  const moves: { id: string; x: number; y: number }[] = [];
  for (const { t } of hits) {
    const options: { x: number; y: number; d: number }[] = [];
    const left = rect.x - t.w;
    const right = rect.x + rect.w;
    const up = rect.y - t.h;
    const down = rect.y + rect.h;
    if (left >= 0) options.push({ x: left, y: t.y, d: Math.abs(t.x - left) });
    if (right + t.w <= GRID_W) options.push({ x: right, y: t.y, d: Math.abs(t.x - right) });
    if (up >= 0) options.push({ x: t.x, y: up, d: Math.abs(t.y - up) });
    if (down + t.h <= GRID_H) options.push({ x: t.x, y: down, d: Math.abs(t.y - down) });
    options.sort((a, b) => a.d - b.d);

    let placed = false;
    for (const o of options) {
      const cand = { x: o.x, y: o.y, w: t.w, h: t.h };
      const blockedByStill = collides(cand, still, new Set());
      const blockedByMoved = moves.some((m) => {
        const mt = others.find((x) => x.id === m.id)!;
        return rectsOverlap(cand, { x: m.x, y: m.y, w: mt.w, h: mt.h });
      });
      if (!blockedByStill && !blockedByMoved && !rectsOverlap(cand, rect)) {
        moves.push({ id: t.id, x: o.x, y: o.y });
        placed = true;
        break;
      }
    }
    if (!placed) return { kind: "invalid", rect };
  }
  return { kind: "nudge", rect, moves };
}

/* ------------------------------ edge resize -------------------------------- */
/* Issue #11: tiles resize from any side. A border that is SHARED with
   neighboring tiles moves for all of them — grow one side and the neighbors
   shrink; shrink it and they grow to keep the border shared. A tile that does
   not share the border blocks it: the border stops at the obstacle (or at a
   tile's minimum size). */

export function sidesOf(edge: ResizeEdge): ResizeSide[] {
  return edge.split("") as ResizeSide[];
}

export interface EdgeResizePlan {
  /** Every rect this resize changes: the tile itself + shared-border neighbors. */
  rects: Map<string, DropRect>;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.51;
const overlap1D = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && a2 > b1;

/**
 * Plan moving one or more of a tile's borders to new absolute positions.
 * Returns the full set of changed rects (self + shared-border neighbors),
 * already clamped against minimum sizes and blocking tiles.
 */
export function planEdgeResize(
  tiles: TileInstance[],
  tileId: string,
  borders: Partial<Record<ResizeSide, number>>,
): EdgeResizePlan {
  const rects = new Map<string, DropRect>();
  const rectOf = (t: TileInstance): DropRect =>
    rects.get(t.id) ?? { x: t.x, y: t.y, w: t.w, h: t.h };
  const self = tiles.find((t) => t.id === tileId);
  if (!self) return { rects };

  for (const side of ["e", "w", "s", "n"] as ResizeSide[]) {
    const desired = borders[side];
    if (desired === undefined) continue;
    const r = rectOf(self);
    const horizontal = side === "e" || side === "w";
    const cur = side === "e" ? r.x + r.w : side === "w" ? r.x : side === "s" ? r.y + r.h : r.y;

    // Tiles sharing this exact border along the tile's cross-range.
    const sharers = tiles.filter((t) => {
      if (t.id === tileId) return false;
      const tr = rectOf(t);
      const touches =
        side === "e" ? near(tr.x, cur)
        : side === "w" ? near(tr.x + tr.w, cur)
        : side === "s" ? near(tr.y, cur)
        : near(tr.y + tr.h, cur);
      const across = horizontal
        ? overlap1D(tr.y, tr.y + tr.h, r.y, r.y + r.h)
        : overlap1D(tr.x, tr.x + tr.w, r.x, r.x + r.w);
      return touches && across;
    });
    const sharerIds = new Set(sharers.map((t) => t.id));

    // Clamp to the tile's own minimum and the workspace bounds.
    const selfMin = tileMinSize(self);
    let p = Math.round(desired);
    if (side === "e") p = Math.min(GRID_W, Math.max(r.x + selfMin.w, p));
    if (side === "w") p = Math.max(0, Math.min(r.x + r.w - selfMin.w, p));
    if (side === "s") p = Math.min(GRID_H, Math.max(r.y + selfMin.h, p));
    if (side === "n") p = Math.max(0, Math.min(r.y + r.h - selfMin.h, p));

    const growing = side === "e" || side === "s" ? p > cur : p < cur;

    if (growing) {
      // Non-sharing tiles in the way stop the border (issue #11).
      for (const t of tiles) {
        if (t.id === tileId || sharerIds.has(t.id)) continue;
        const tr = rectOf(t);
        const across = horizontal
          ? overlap1D(tr.y, tr.y + tr.h, r.y, r.y + r.h)
          : overlap1D(tr.x, tr.x + tr.w, r.x, r.x + r.w);
        if (!across) continue;
        if (side === "e" && tr.x >= cur - 0.51) p = Math.min(p, tr.x);
        if (side === "w" && tr.x + tr.w <= cur + 0.51) p = Math.max(p, tr.x + tr.w);
        if (side === "s" && tr.y >= cur - 0.51) p = Math.min(p, tr.y);
        if (side === "n" && tr.y + tr.h <= cur + 0.51) p = Math.max(p, tr.y + tr.h);
      }
      // Sharers shrink, but never below their own minimum.
      for (const t of sharers) {
        const tr = rectOf(t);
        const min = tileMinSize(t);
        if (side === "e") p = Math.min(p, tr.x + tr.w - min.w);
        if (side === "w") p = Math.max(p, tr.x + min.w);
        if (side === "s") p = Math.min(p, tr.y + tr.h - min.h);
        if (side === "n") p = Math.max(p, tr.y + min.h);
      }
    } else if (p !== cur) {
      // Shrinking: sharers grow to follow the border, but anything standing in
      // the vacated strip beside the tile blocks them.
      for (const t of sharers) {
        const tr = rectOf(t);
        for (const o of tiles) {
          if (o.id === tileId || o.id === t.id || sharerIds.has(o.id)) continue;
          const or = rectOf(o);
          const acrossSharer = horizontal
            ? overlap1D(or.y, or.y + or.h, tr.y, tr.y + tr.h)
            : overlap1D(or.x, or.x + or.w, tr.x, tr.x + tr.w);
          if (!acrossSharer) continue;
          if (side === "e" && or.x + or.w <= cur + 0.51) p = Math.max(p, or.x + or.w);
          if (side === "w" && or.x >= cur - 0.51) p = Math.min(p, or.x);
          if (side === "s" && or.y + or.h <= cur + 0.51) p = Math.max(p, or.y + or.h);
          if (side === "n" && or.y >= cur - 0.51) p = Math.min(p, or.y);
        }
      }
    }

    if (p === cur) continue;

    // Apply: the tile takes the new border; every sharer keeps it shared.
    const next = { ...r };
    if (side === "e") next.w = p - next.x;
    if (side === "w") { next.w = next.x + next.w - p; next.x = p; }
    if (side === "s") next.h = p - next.y;
    if (side === "n") { next.h = next.y + next.h - p; next.y = p; }
    rects.set(self.id, next);

    for (const t of sharers) {
      const tr = rectOf(t);
      const moved = { ...tr };
      if (side === "e") { moved.w = tr.x + tr.w - p; moved.x = p; }
      if (side === "w") { moved.w = p - tr.x; }
      if (side === "s") { moved.h = tr.y + tr.h - p; moved.y = p; }
      if (side === "n") { moved.h = p - tr.y; }
      rects.set(t.id, moved);
    }
  }
  return { rects };
}

/** Commit an edge-resize plan to the current arrangement. */
export function applyEdgeResize(plan: EdgeResizePlan): void {
  if (plan.rects.size === 0) return;
  mutateTiles((tiles) =>
    tiles.map((t) => (plan.rects.has(t.id) ? { ...t, ...plan.rects.get(t.id)! } : t)),
  );
}

/* ------------------------------ tile actions ------------------------------- */

export function applyDrop(plan: DropPlan, tile: TileInstance, opts: { fromScratchId?: string } = {}): void {
  if (plan.kind === "invalid" || plan.kind === "scratchpad") return;
  const dropped: TileInstance = { ...tile, ...plan.rect };

  mutateTiles((tiles) => {
    let next = tiles.filter((t) => t.id !== tile.id);
    if (plan.kind === "replace") {
      const target = next.find((t) => t.id === plan.targetId);
      next = next.filter((t) => t.id !== plan.targetId);
      if (target) {
        record({
          type: "system.event",
          summary: `Replaced ${tileName(target)} with ${tileName(tile)}`,
          detail: "The replaced tile can be returned from the Apps launcher.",
        });
      }
    } else if (plan.kind === "fill-gap") {
      next = next.filter((t) => t.id !== plan.gapId);
    } else if (plan.kind === "nudge") {
      next = next.map((t) => {
        const m = plan.moves.find((x) => x.id === t.id);
        return m ? { ...t, x: m.x, y: m.y } : t;
      });
    }
    return [...next, dropped];
  });

  if (opts.fromScratchId) {
    mutateScratch((items) => items.filter((i) => i.id !== opts.fromScratchId));
  }
  trackFreeformAdd(tile.id, opts.fromScratchId !== undefined);
}

/** In Freeform, remember which tiles arrived during the session. */
function trackFreeformAdd(tileId: string, external: boolean): void {
  const s = load();
  if (!s.freeform) return;
  const existedInBase = s.layouts
    .find((l) => l.id === s.freeform!.baseId)
    ?.tiles.some((t) => t.id === tileId);
  if (!existedInBase || external) {
    if (!s.freeform.addedIds.includes(tileId)) {
      commit({ ...s, freeform: { ...s.freeform, addedIds: [...s.freeform.addedIds, tileId] } });
    }
  }
}

export function addTile(
  kind: TileKind,
  extra: Partial<TileInstance> = {},
  at?: { x: number; y: number },
): TileInstance {
  const tile = makeTile(kind, {}, extra);
  if (at) {
    const placed = { ...tile, ...at };
    mutateTiles((ts) => [...ts, placed]);
    trackFreeformAdd(placed.id, true);
    return placed;
  }
  // Placement always succeeds: shrink, fill a gap, or make room (issue #9).
  mutateTiles((ts) => placeInto(ts, tile));
  trackFreeformAdd(tile.id, true);
  return getCurrentArrangement().tiles.find((t) => t.id === tile.id) ?? tile;
}

export function removeTile(tileId: string, opts: { holdGap?: boolean } = {}): void {
  mutateTiles((tiles) => {
    const target = tiles.find((t) => t.id === tileId);
    if (!target) return tiles;
    const rest = tiles.filter((t) => t.id !== tileId);
    if (opts.holdGap && target.kind !== "gap") {
      return [...rest, makeTile("gap", { x: target.x, y: target.y, w: target.w, h: target.h })];
    }
    return rest;
  });
  const s = load();
  if (s.focus?.tileId === tileId) commit({ ...load(), focus: null });
}

export function resizeTile(tileId: string, w: number, h: number): void {
  mutateTiles((tiles) =>
    tiles.map((t) => (t.id === tileId ? { ...t, w, h } : t)),
  );
}

export function updateTile(tileId: string, patch: Partial<TileInstance>): void {
  // Widgets are customizable tiles too (rename, accent, lifecycle…).
  const s = load();
  if (s.widgets.some((w) => w.id === tileId)) {
    mutateWidgets((ws) => ws.map((w) => (w.id === tileId ? { ...w, ...patch } : w)));
    return;
  }
  mutateTiles((tiles) => tiles.map((t) => (t.id === tileId ? { ...t, ...patch } : t)));
}

export function updateTileSettings(tileId: string, patch: Record<string, unknown>): void {
  // Widgets carry settings too (clock format on a pinned clock, etc.).
  const s = load();
  if (s.widgets.some((w) => w.id === tileId)) {
    mutateWidgets((ws) =>
      ws.map((w) => (w.id === tileId ? { ...w, settings: { ...(w.settings ?? {}), ...patch } } : w)),
    );
    return;
  }
  mutateTiles((tiles) =>
    tiles.map((t) =>
      t.id === tileId ? { ...t, settings: { ...(t.settings ?? {}), ...patch } } : t,
    ),
  );
}

/** Hold a deliberate gap: an empty Anchor reserving space until filled. */
export function holdGap(at: { x: number; y: number }): void {
  const tiles = getCurrentArrangement().tiles;
  // Grow a reasonable footprint that fits, favoring 24×16 units.
  for (const [w, h] of [[24, 16], [16, 16], [16, 8], [8, 8]] as const) {
    const rect = clampRect({ x: at.x, y: at.y, w, h });
    if (!tiles.some((t) => rectsOverlap(rect, t))) {
      mutateTiles((ts) => [...ts, makeTile("gap", rect)]);
      return;
    }
  }
}

/* --------------------------- persistent widgets ---------------------------- */
/* Chrome is made from privileged tiles (brief §7–8): any placed tile can be
   pinned to a workspace edge, where it persists across views and reserves its
   band. Unpinning returns it to the current layout as a normal tile. */

/** Pin a placed tile to an edge (nearest by default) as a persistent widget. */
export function pinTileToEdge(tileId: string, edge?: EdgeSide): void {
  const tile = getCurrentArrangement().tiles.find((t) => t.id === tileId);
  if (!tile || tile.kind === "gap") return;
  const side = edge ?? nearestEdge(tile);
  const s = load();
  if (s.focus?.tileId === tileId) commit({ ...s, focus: null });
  mutateTiles((ts) => ts.filter((t) => t.id !== tileId));
  mutateWidgets((ws) => [...ws, toEdgeWidget(tile, side)]);
  record({
    type: "system.event",
    summary: `Pinned ${tileName(tile)} to the ${side} edge`,
    detail: "It now appears across views and reserves its band of the workspace.",
  });
}

/** Move an existing widget to a different edge. */
export function moveWidgetToEdge(widgetId: string, edge: EdgeSide): void {
  mutateWidgets((ws) => ws.map((w) => (w.id === widgetId ? toEdgeWidget(w, edge) : w)));
}

/** Adjust an edge widget's band thickness (units). */
export function resizeWidget(widgetId: string, thickness: number): void {
  mutateWidgets((ws) =>
    ws.map((w) => {
      if (w.id !== widgetId) return w;
      const edge = w.edge ?? "top";
      return edge === "top" || edge === "bottom"
        ? { ...w, h: Math.min(16, Math.max(2, Math.round(thickness))) }
        : { ...w, w: Math.min(32, Math.max(6, Math.round(thickness))) };
    }),
  );
}

/** Turn persistence off: the widget becomes a normal tile on the current layout. */
export function unpinWidget(widgetId: string): void {
  const s = load();
  const w = s.widgets.find((x) => x.id === widgetId);
  if (!w) return;
  if (w.kind === "home" && !headerCoversRequiredWithout(widgetId)) {
    deliver({
      title: "The header has to keep its required controls",
      detail:
        "This segment carries the last logo, mode switcher, Freeform, Apps, or Settings control. Add another segment carrying them first.",
      source: "Header",
    });
    return;
  }
  mutateWidgets((ws) => ws.filter((x) => x.id !== widgetId));
  const meta = !CUSTOM_TILE_KINDS.has(w.kind) ? TILE_META[w.kind as BuiltinTileKind] : null;
  const size = {
    w: meta?.defW ?? (w.kind === "devwidget" ? DEVWIDGET_DEFAULTS.defW : 24),
    h: meta?.defH ?? (w.kind === "devwidget" ? DEVWIDGET_DEFAULTS.defH : 16),
  };
  mutateTiles((ts) => placeInto(ts, { ...w, persistent: false, edge: undefined, ...size }));
  record({ type: "system.event", summary: `Unpinned ${tileName(w)} — it is a placed tile again` });
}

/** Remove a widget entirely (it can be re-added from Apps). */
export function removeWidget(widgetId: string): void {
  const w = load().widgets.find((x) => x.id === widgetId);
  if (w?.kind === "home" && !headerCoversRequiredWithout(widgetId)) {
    deliver({
      title: "You cannot remove the last header controls",
      detail:
        "The logo, mode switcher, Freeform, Apps, and Settings must stay reachable so you can always return to any surface.",
      source: "Header",
    });
    return;
  }
  mutateWidgets((ws) => ws.filter((x) => x.id !== widgetId));
}

function toEdgeWidget(t: TileInstance, edge: EdgeSide): TileInstance {
  const horizontal = edge === "top" || edge === "bottom";
  const defTh = t.kind === "home" ? 4 : horizontal ? Math.min(12, Math.max(3, t.h)) : Math.min(24, Math.max(8, t.w));
  const th = horizontal ? Math.min(16, Math.max(2, defTh)) : Math.min(32, Math.max(6, defTh));
  const base: TileInstance = { ...t, persistent: true, edge };
  switch (edge) {
    case "top":
      return { ...base, x: 0, y: 0, w: GRID_W, h: th };
    case "bottom":
      return { ...base, x: 0, y: GRID_H - th, w: GRID_W, h: th };
    case "left":
      return { ...base, x: 0, y: 0, w: th, h: GRID_H };
    case "right":
      return { ...base, x: GRID_W - th, y: 0, w: th, h: GRID_H };
  }
}

// Re-export for consumers that already import from the store.
export { widgetThickness };

/* ------------------------------- scratchpad -------------------------------- */

export function sendToScratchpad(tileId: string): void {
  const tile = getCurrentArrangement().tiles.find((t) => t.id === tileId);
  if (!tile || tile.kind === "scratchpad" || tile.kind === "gap") return;
  mutateTiles((tiles) => tiles.filter((t) => t.id !== tileId));
  mutateScratch((items) => [
    {
      id: tid("s"),
      tile,
      pinned: false,
      addedAt: Date.now(),
      lastUsed: Date.now(),
      activity: "warm",
    },
    ...items,
  ]);
}

/** Stash an unplaced tile (e.g. Freeform temporaries) into the Scratchpad. */
export function stashTile(tile: TileInstance): void {
  mutateScratch((items) => [
    { id: tid("s"), tile, pinned: false, addedAt: Date.now(), lastUsed: Date.now(), activity: "paused" },
    ...items,
  ]);
}

export function scratchRemove(itemId: string): void {
  mutateScratch((items) => items.filter((i) => i.id !== itemId));
}

export function scratchPin(itemId: string, pinned: boolean): void {
  mutateScratch((items) => items.map((i) => (i.id === itemId ? { ...i, pinned } : i)));
}

export function scratchSetActivity(itemId: string, activity: ScratchItem["activity"]): void {
  mutateScratch((items) => items.map((i) => (i.id === itemId ? { ...i, activity } : i)));
}

export function clearScratchpad(): void {
  mutateScratch((items) => items.filter((i) => i.pinned));
}

/** Promote a scratch item into a placed tile. Placement always succeeds. */
export function promoteScratchItem(itemId: string): void {
  const item = getScratchpad().find((i) => i.id === itemId);
  if (!item) return;
  mutateTiles((ts) => placeInto(ts, item.tile));
  mutateScratch((items) => items.filter((i) => i.id !== itemId));
  trackFreeformAdd(item.tile.id, true);
}

/* ---------------------------------- focus ---------------------------------- */
/* Focus is a projection of the current arrangement (change brief §6): the
   focused tile grows into a large slot, everything else compresses around it.
   Nothing here mutates the layout — leaving Focus restores it untouched. */

export function focusTile(tileId: string): void {
  const s = load();
  const tile = getCurrentArrangement().tiles.find((t) => t.id === tileId);
  if (!tile || tile.kind === "gap") return;
  // Remember the target (with a detached snapshot as fallback) so the
  // header's Dashboard ↔ Focus switcher can lean back into it (issue #6).
  commit({ ...s, focus: { tileId }, lastFocus: { tileId, tile: { ...tile } } });
}

/** Focus a detached tile: from the Scratchpad, an app, or a bare kind. */
export function focusDetached(tile: TileInstance, scratchId?: string): void {
  const s = load();
  commit({ ...s, focus: { tile, scratchId }, lastFocus: { tile: { ...tile } } });
  if (scratchId) {
    mutateScratch((items) =>
      items.map((i) => (i.id === scratchId ? { ...i, lastUsed: Date.now(), activity: "active" } : i)),
    );
  }
}

/**
 * The header's mode switcher, Focus side (issue #6): reopen whatever Focus
 * last showed. If nothing was ever truly focused, Focus is just empty space.
 */
export function switchToFocus(): void {
  const s = load();
  if (s.focus) return;
  const last = s.lastFocus;
  if (last?.tileId) {
    const placed = getCurrentArrangement().tiles.find((t) => t.id === last.tileId);
    if (placed && placed.kind !== "gap") {
      commit({ ...s, focus: { tileId: last.tileId } });
      return;
    }
  }
  if (last?.tile) {
    commit({ ...s, focus: { tile: { ...last.tile } } });
    return;
  }
  commit({ ...s, focus: { empty: true } });
}

export function focusApp(appId: AppId): void {
  // Prefer the placed tile for this app / builtin so Focus keeps its origin.
  const tiles = getCurrentArrangement().tiles;
  const placedApp = tiles.find((t) => t.kind === "app" && t.app === appId);
  if (placedApp) return focusTile(placedApp.id);
  const builtinKind = (Object.keys(TILE_META) as BuiltinTileKind[]).find(
    (k) => TILE_META[k].focusApp === appId,
  );
  if (builtinKind) {
    const placedBuiltin = tiles.find((t) => t.kind === builtinKind);
    if (placedBuiltin) return focusTile(placedBuiltin.id);
  }
  focusDetached(makeTile("app", {}, { app: appId }));
}

export function defocus(): void {
  const s = load();
  if (!s.focus) return;
  if (s.focus.scratchId) {
    mutateScratch((items) =>
      items.map((i) => (i.id === s.focus!.scratchId ? { ...i, activity: "warm" } : i)),
    );
  }
  commit({ ...load(), focus: null });
}

/**
 * The Locus logo's invariant behavior (change brief §4): always return to the
 * Dashboard. In Freeform it only leaves Focus — the draft's explicit exits
 * stay in charge, so nothing is silently discarded.
 */
export function goToDashboard(): void {
  const s = load();
  if (!s.freeform && s.activeLayoutId !== DASHBOARD_ID) {
    switchLayout(DASHBOARD_ID); // clears focus too
    return;
  }
  if (s.focus) commit({ ...s, focus: null });
}

/* --------------------------------- freeform -------------------------------- */

export function enterFreeform(): void {
  const s = load();
  if (s.freeform) return;
  const base = getActiveLayout();
  const draft: DesktopLayout = {
    ...base,
    id: `freeform-${base.id}`,
    tiles: base.tiles.map((t) => ({ ...t })),
  };
  commit({ ...s, focus: null, freeform: { baseId: base.id, draft, addedIds: [] } });
  record({ type: "system.event", summary: "Entered Freeform Mode — changes are temporary" });
}

export function exitFreeformDiscard(): void {
  const s = load();
  if (!s.freeform) return;
  commit({ ...s, freeform: null, focus: null });
  record({ type: "system.event", summary: "Left Freeform without saving" });
}

export function exitFreeformApply(): void {
  const s = load();
  if (!s.freeform) return;
  const layouts = s.layouts.map((l) =>
    l.id === s.freeform!.baseId ? { ...l, tiles: s.freeform!.draft.tiles } : l,
  );
  commit({ ...s, layouts, freeform: null, focus: null });
  flashSaved();
  record({ type: "system.event", summary: "Applied Freeform changes to the current layout" });
}

export function exitFreeformSaveAs(name: string): DesktopLayout {
  const s = load();
  const tiles = s.freeform ? s.freeform.draft.tiles : getActiveLayout().tiles;
  const ws: DesktopLayout = {
    id: tid("ws"),
    name: name.trim() || "Workspace",
    tiles: tiles.map((t) => ({ ...t })),
    aiContextScope: deriveScope(tiles),
  };
  commit({ ...load(), layouts: [...load().layouts, ws], freeform: null, focus: null, activeLayoutId: ws.id });
  flashSaved();
  record({ type: "system.event", summary: `Saved Workspace: ${ws.name}` });
  deliver({ title: `Workspace “${ws.name}” saved`, detail: "Open it any time from the Workspaces tile.", source: "Workspaces" });
  return ws;
}

/** Move Freeform-added temporaries to the Scratchpad, then discard the rest. */
export function exitFreeformToScratchpad(): void {
  const s = load();
  if (!s.freeform) return;
  const temps = s.freeform.draft.tiles.filter((t) => s.freeform!.addedIds.includes(t.id) && t.kind !== "gap");
  for (const t of temps) stashTile(t);
  exitFreeformDiscard();
  if (temps.length) {
    deliver({ title: `${temps.length} temporary tile${temps.length === 1 ? "" : "s"} moved to Scratchpad`, source: "Freeform" });
  }
}

function deriveScope(tiles: TileInstance[]): AppId[] {
  const ids = new Set<AppId>();
  for (const t of tiles) {
    if (t.kind === "app" && t.app && t.aiVisible !== false) ids.add(t.app);
    if (!CUSTOM_TILE_KINDS.has(t.kind) && t.aiVisible !== false) {
      const focusApp = TILE_META[t.kind as BuiltinTileKind]?.focusApp;
      if (focusApp) ids.add(focusApp);
    }
  }
  return [...ids];
}

/* -------------------------------- workspaces ------------------------------- */

export function switchLayout(id: string): void {
  const s = load();
  const layout = s.layouts.find((l) => l.id === id);
  if (!layout) return;
  commit({ ...s, activeLayoutId: id, focus: null, freeform: null });
  record({
    type: "system.event",
    summary: id === DASHBOARD_ID ? "Returned to Dashboard" : `Opened workspace: ${layout.name}`,
  });
}

export function saveCurrentAsWorkspace(name: string): DesktopLayout {
  return exitFreeformSaveAs(name);
}

export function renameWorkspace(id: string, name: string): void {
  const s = load();
  commit({
    ...s,
    layouts: s.layouts.map((l) => (l.id === id && !l.builtIn ? { ...l, name: name.trim() || l.name } : l)),
  });
  flashSaved();
}

export function duplicateWorkspace(id: string): void {
  const s = load();
  const src = s.layouts.find((l) => l.id === id);
  if (!src) return;
  const copy: DesktopLayout = {
    ...src,
    id: tid("ws"),
    name: `${src.name} copy`,
    builtIn: false,
    tiles: src.tiles.map((t) => ({ ...t, id: tid() })),
  };
  commit({ ...s, layouts: [...s.layouts, copy] });
  flashSaved();
}

export function deleteWorkspace(id: string): void {
  const s = load();
  if (id === DASHBOARD_ID) return;
  const layouts = s.layouts.filter((l) => l.id !== id);
  commit({
    ...s,
    layouts,
    activeLayoutId: s.activeLayoutId === id ? DASHBOARD_ID : s.activeLayoutId,
  });
  flashSaved();
}

export function setWorkspaceOption(id: string, patch: Partial<Pick<DesktopLayout, "ownScratchpad" | "accent" | "aiContextScope">>): void {
  const s = load();
  commit({ ...s, layouts: s.layouts.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  flashSaved();
}

export function resetDashboard(): void {
  const s = load();
  commit({
    ...s,
    layouts: s.layouts.map((l) => (l.id === DASHBOARD_ID ? defaultDashboard() : l)),
    widgets: s.widgets.some((w) => w.kind === "home") ? s.widgets : [...s.widgets, defaultHomeWidget()],
    focus: null,
    freeform: null,
  });
  flashSaved();
  record({ type: "system.event", summary: "Dashboard reset to the default arrangement" });
}

export function exportWorkspace(id: string): string {
  const layout = load().layouts.find((l) => l.id === id);
  return JSON.stringify(layout, null, 2);
}

/* -------------------------------- low power -------------------------------- */

export function setLowPower(on: boolean): void {
  const s = load();
  commit({ ...s, lowPower: on });
  document.documentElement.toggleAttribute("data-low-power", on);
  record({ type: "system.event", summary: on ? "Low-power mode on" : "Low-power mode off" });
}

/** Apply persisted low-power state at boot. */
export function initDesktop(): void {
  const s = load();
  document.documentElement.toggleAttribute("data-low-power", s.lowPower);
}
