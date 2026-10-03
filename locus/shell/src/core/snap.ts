/*
 * Snapping and guides — the precision under the freeform feel (brief §3).
 * ---------------------------------------------------------------------------
 * Dragging and resizing work in continuous layout units; this module decides
 * where they land. Within tolerance, edges snap to other tiles' edges (shared
 * borders), centers snap to centers, gaps snap to equal spacing, and resizes
 * snap to matching sizes. Otherwise positions round to the dense unit grid.
 *
 * Every snap returns the guides that justify it, so the renderer can draw
 * alignment lines and size-match outlines contextually — the grid itself
 * never needs to be visible.
 */

import { GRID_H, GRID_W } from "./tileMeta";
import type { DropRect, TileInstance } from "@/types";

export interface SnapGuide {
  /** "v" = vertical line at x=pos; "h" = horizontal line at y=pos. */
  axis: "v" | "h";
  pos: number;
  /** Extent along the other axis, for drawing a bounded line. */
  from: number;
  to: number;
  kind: "edge" | "center" | "gap" | "size";
  /** For "size" guides: the tile whose size was matched. */
  rect?: DropRect;
}

export interface SnapResult extends DropRect {
  guides: SnapGuide[];
}

interface Candidate {
  /** Snapped value for the moving edge/position. */
  value: number;
  dist: number;
  guides: SnapGuide[];
}

function span(a1: number, a2: number, b1: number, b2: number): { from: number; to: number } {
  return { from: Math.min(a1, b1), to: Math.max(a2, b2) };
}

function overlaps1D(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && a2 > b1;
}

function best(cands: Candidate[], tol: number): Candidate | null {
  let win: Candidate | null = null;
  for (const c of cands) {
    if (c.dist <= tol && (!win || c.dist < win.dist)) win = c;
  }
  return win;
}

/* ---------------------------------- move ----------------------------------- */

/**
 * Snap a dragged rect. X and Y snap independently; un-snapped axes round to
 * whole units so free placement still lands on the dense grid.
 */
export function snapMoveRect(
  tiles: TileInstance[],
  dragId: string | null,
  raw: DropRect,
  tol: number,
): SnapResult {
  const others = tiles.filter((t) => t.id !== dragId);
  const { w, h } = raw;

  const xCands: Candidate[] = [];
  const yCands: Candidate[] = [];

  // Workspace edges and centerlines.
  xCands.push(
    { value: 0, dist: Math.abs(raw.x), guides: [{ axis: "v", pos: 0, from: 0, to: GRID_H, kind: "edge" }] },
    { value: GRID_W - w, dist: Math.abs(raw.x - (GRID_W - w)), guides: [{ axis: "v", pos: GRID_W, from: 0, to: GRID_H, kind: "edge" }] },
    { value: (GRID_W - w) / 2, dist: Math.abs(raw.x - (GRID_W - w) / 2), guides: [{ axis: "v", pos: GRID_W / 2, from: 0, to: GRID_H, kind: "center" }] },
  );
  yCands.push(
    { value: 0, dist: Math.abs(raw.y), guides: [{ axis: "h", pos: 0, from: 0, to: GRID_W, kind: "edge" }] },
    { value: GRID_H - h, dist: Math.abs(raw.y - (GRID_H - h)), guides: [{ axis: "h", pos: GRID_H, from: 0, to: GRID_W, kind: "edge" }] },
    { value: (GRID_H - h) / 2, dist: Math.abs(raw.y - (GRID_H - h) / 2), guides: [{ axis: "h", pos: GRID_H / 2, from: 0, to: GRID_W, kind: "center" }] },
  );

  // Other tiles: edge-to-edge (shared borders), edge alignment, center alignment.
  for (const t of others) {
    const vs = span(raw.y, raw.y + h, t.y, t.y + t.h);
    const xTargets: { value: number; guide: number; kind: SnapGuide["kind"] }[] = [
      { value: t.x, guide: t.x, kind: "edge" }, //             left ↔ their left
      { value: t.x + t.w, guide: t.x + t.w, kind: "edge" }, // left ↔ their right (share)
      { value: t.x - w, guide: t.x, kind: "edge" }, //         right ↔ their left (share)
      { value: t.x + t.w - w, guide: t.x + t.w, kind: "edge" }, // right ↔ their right
      { value: t.x + (t.w - w) / 2, guide: t.x + t.w / 2, kind: "center" },
    ];
    for (const c of xTargets) {
      xCands.push({
        value: c.value,
        dist: Math.abs(raw.x - c.value),
        guides: [{ axis: "v", pos: c.guide, from: vs.from, to: vs.to, kind: c.kind }],
      });
    }

    const hs = span(raw.x, raw.x + w, t.x, t.x + t.w);
    const yTargets: { value: number; guide: number; kind: SnapGuide["kind"] }[] = [
      { value: t.y, guide: t.y, kind: "edge" },
      { value: t.y + t.h, guide: t.y + t.h, kind: "edge" },
      { value: t.y - h, guide: t.y, kind: "edge" },
      { value: t.y + t.h - h, guide: t.y + t.h, kind: "edge" },
      { value: t.y + (t.h - h) / 2, guide: t.y + t.h / 2, kind: "center" },
    ];
    for (const c of yTargets) {
      yCands.push({
        value: c.value,
        dist: Math.abs(raw.y - c.value),
        guides: [{ axis: "h", pos: c.guide, from: hs.from, to: hs.to, kind: c.kind }],
      });
    }
  }

  // Equal-gap: centered in the channel between two tiles (brief: equal-gap guides).
  for (const a of others) {
    for (const b of others) {
      if (a === b) continue;
      // Horizontal channel a → b.
      if (
        a.x + a.w < b.x &&
        overlaps1D(a.y, a.y + a.h, raw.y, raw.y + h) &&
        overlaps1D(b.y, b.y + b.h, raw.y, raw.y + h)
      ) {
        const channel = b.x - (a.x + a.w);
        if (channel > w) {
          const value = a.x + a.w + (channel - w) / 2;
          const vsA = span(raw.y, raw.y + h, a.y, a.y + a.h);
          const vsB = span(raw.y, raw.y + h, b.y, b.y + b.h);
          xCands.push({
            value,
            dist: Math.abs(raw.x - value),
            guides: [
              { axis: "v", pos: a.x + a.w, from: vsA.from, to: vsA.to, kind: "gap" },
              { axis: "v", pos: b.x, from: vsB.from, to: vsB.to, kind: "gap" },
            ],
          });
        }
      }
      // Vertical channel a → b.
      if (
        a.y + a.h < b.y &&
        overlaps1D(a.x, a.x + a.w, raw.x, raw.x + w) &&
        overlaps1D(b.x, b.x + b.w, raw.x, raw.x + w)
      ) {
        const channel = b.y - (a.y + a.h);
        if (channel > h) {
          const value = a.y + a.h + (channel - h) / 2;
          const hsA = span(raw.x, raw.x + w, a.x, a.x + a.w);
          const hsB = span(raw.x, raw.x + w, b.x, b.x + b.w);
          yCands.push({
            value,
            dist: Math.abs(raw.y - value),
            guides: [
              { axis: "h", pos: a.y + a.h, from: hsA.from, to: hsA.to, kind: "gap" },
              { axis: "h", pos: b.y, from: hsB.from, to: hsB.to, kind: "gap" },
            ],
          });
        }
      }
    }
  }

  const bx = best(xCands, tol);
  const by = best(yCands, tol);
  return {
    x: bx ? bx.value : Math.round(raw.x),
    y: by ? by.value : Math.round(raw.y),
    w,
    h,
    guides: [...(bx?.guides ?? []), ...(by?.guides ?? [])],
  };
}

/* --------------------------------- resize ---------------------------------- */

/** The four borders a resize can move, as absolute layout coordinates. */
export interface ResizeBorders {
  n?: number;
  e?: number;
  s?: number;
  w?: number;
}

/**
 * Snap resize borders on any side (issue #11). Each moving border snaps to
 * other tiles' edges (that is what keeps borders shared), to the workspace
 * bounds, and to equal-size matches; unsnapped borders round to whole units.
 */
export function snapResizeBorders(
  tiles: TileInstance[],
  tile: TileInstance,
  borders: ResizeBorders,
  tol: number,
): { borders: ResizeBorders; guides: SnapGuide[] } {
  const others = tiles.filter((t) => t.id !== tile.id);
  const out: ResizeBorders = {};
  const guides: SnapGuide[] = [];

  const snapOne = (
    raw: number,
    axis: "v" | "h",
    boundPos: number,
    edgesOf: (t: TileInstance) => [number, number],
    sizeValue: (t: TileInstance) => number,
    sizeRect: (t: TileInstance) => DropRect,
  ): number => {
    const cands: Candidate[] = [
      {
        value: boundPos,
        dist: Math.abs(raw - boundPos),
        guides: [
          axis === "v"
            ? { axis, pos: boundPos, from: 0, to: GRID_H, kind: "edge" }
            : { axis, pos: boundPos, from: 0, to: GRID_W, kind: "edge" },
        ],
      },
    ];
    for (const t of others) {
      const ext =
        axis === "v" ? span(tile.y, tile.y + tile.h, t.y, t.y + t.h) : span(tile.x, tile.x + tile.w, t.x, t.x + t.w);
      for (const edge of edgesOf(t)) {
        cands.push({
          value: edge,
          dist: Math.abs(raw - edge),
          guides: [{ axis, pos: edge, from: ext.from, to: ext.to, kind: "edge" }],
        });
      }
      // Equal size: the border position that matches this tile's width/height.
      const value = sizeValue(t);
      cands.push({
        value,
        dist: Math.abs(raw - value),
        guides: [
          axis === "v"
            ? { axis, pos: value, from: tile.y, to: tile.y + tile.h, kind: "size", rect: sizeRect(t) }
            : { axis, pos: value, from: tile.x, to: tile.x + tile.w, kind: "size", rect: sizeRect(t) },
        ],
      });
    }
    const win = best(cands, tol);
    if (win) {
      guides.push(...win.guides);
      return win.value;
    }
    return Math.round(raw);
  };

  const rect = (t: TileInstance): DropRect => ({ x: t.x, y: t.y, w: t.w, h: t.h });
  if (borders.e !== undefined) {
    out.e = snapOne(borders.e, "v", GRID_W, (t) => [t.x, t.x + t.w], (t) => tile.x + t.w, rect);
  }
  if (borders.w !== undefined) {
    out.w = snapOne(borders.w, "v", 0, (t) => [t.x, t.x + t.w], (t) => tile.x + tile.w - t.w, rect);
  }
  if (borders.s !== undefined) {
    out.s = snapOne(borders.s, "h", GRID_H, (t) => [t.y, t.y + t.h], (t) => tile.y + t.h, rect);
  }
  if (borders.n !== undefined) {
    out.n = snapOne(borders.n, "h", 0, (t) => [t.y, t.y + t.h], (t) => tile.y + tile.h - t.h, rect);
  }
  return { borders: out, guides };
}

/**
 * Snap a resize. The right/bottom edges snap to other tiles' edges (shared
 * borders) and the workspace bounds; widths/heights snap to matching sizes
 * (equal-size guides).
 */
export function snapResizeRect(
  tiles: TileInstance[],
  tile: TileInstance,
  rawW: number,
  rawH: number,
  tol: number,
  edges: { e: boolean; s: boolean },
): SnapResult {
  const others = tiles.filter((t) => t.id !== tile.id);
  const guides: SnapGuide[] = [];
  let w = rawW;
  let h = rawH;

  if (edges.e) {
    const right = tile.x + rawW;
    const cands: Candidate[] = [
      { value: GRID_W, dist: Math.abs(right - GRID_W), guides: [{ axis: "v", pos: GRID_W, from: 0, to: GRID_H, kind: "edge" }] },
    ];
    for (const t of others) {
      const vs = span(tile.y, tile.y + rawH, t.y, t.y + t.h);
      for (const edge of [t.x, t.x + t.w]) {
        if (edge > tile.x) {
          cands.push({
            value: edge,
            dist: Math.abs(right - edge),
            guides: [{ axis: "v", pos: edge, from: vs.from, to: vs.to, kind: "edge" }],
          });
        }
      }
      // Equal width.
      cands.push({
        value: tile.x + t.w,
        dist: Math.abs(rawW - t.w),
        guides: [{ axis: "v", pos: tile.x + t.w, from: tile.y, to: tile.y + rawH, kind: "size", rect: { x: t.x, y: t.y, w: t.w, h: t.h } }],
      });
    }
    const win = best(cands, tol);
    if (win) {
      w = win.value - tile.x;
      guides.push(...win.guides);
    } else {
      w = Math.round(rawW);
    }
  }

  if (edges.s) {
    const bottom = tile.y + rawH;
    const cands: Candidate[] = [
      { value: GRID_H, dist: Math.abs(bottom - GRID_H), guides: [{ axis: "h", pos: GRID_H, from: 0, to: GRID_W, kind: "edge" }] },
    ];
    for (const t of others) {
      const hs = span(tile.x, tile.x + rawW, t.x, t.x + t.w);
      for (const edge of [t.y, t.y + t.h]) {
        if (edge > tile.y) {
          cands.push({
            value: edge,
            dist: Math.abs(bottom - edge),
            guides: [{ axis: "h", pos: edge, from: hs.from, to: hs.to, kind: "edge" }],
          });
        }
      }
      // Equal height.
      cands.push({
        value: tile.y + t.h,
        dist: Math.abs(rawH - t.h),
        guides: [{ axis: "h", pos: tile.y + t.h, from: tile.x, to: tile.x + rawW, kind: "size", rect: { x: t.x, y: t.y, w: t.w, h: t.h } }],
      });
    }
    const win = best(cands, tol);
    if (win) {
      h = win.value - tile.y;
      guides.push(...win.guides);
    } else {
      h = Math.round(rawH);
    }
  }

  return { x: tile.x, y: tile.y, w, h, guides };
}
