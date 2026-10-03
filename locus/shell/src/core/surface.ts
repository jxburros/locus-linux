/*
 * Surface geometry — the fixed spatial operating surface.
 * ---------------------------------------------------------------------------
 * The workspace is GRID_W × GRID_H units and never scrolls. Three coordinate
 * spaces meet here:
 *
 *   surface units   the whole visible workspace (widgets live here)
 *   layout units    the same 96×54 space, but projected into whatever area
 *                   persistent edge widgets leave over ("usable area")
 *   pixels          whatever the viewport gives us
 *
 * Layouts are authored oblivious of chrome: their tiles always span the full
 * unit space and are squeezed into the usable area at render time. That is
 * how a header widget "reserves space" without rewriting every layout.
 *
 * Pixel rects round *endpoints*, not sizes, so tiles that share a unit edge
 * share the exact same pixel — the foundation for merged borders.
 */

import { GRID_H, GRID_W } from "./tileMeta";
import type { DropRect, EdgeSide, TileInstance } from "@/types";

/** A resolved pixel rectangle (workspace-relative). */
export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/* ------------------------------ chrome bands ------------------------------- */

export interface ChromeLayout {
  /** Widget id → its band rect in surface units. */
  rects: Map<string, DropRect>;
  /** What is left for the projected layout, in surface units. */
  usable: DropRect;
}

/** Band thickness of an edge widget, clamped to something sane. */
export function widgetThickness(w: TileInstance): number {
  const edge = w.edge ?? "top";
  if (edge === "top" || edge === "bottom") return Math.min(16, Math.max(2, w.h));
  return Math.min(32, Math.max(6, w.w));
}

/**
 * Stack persistent widgets into edge bands (outermost first, in array order)
 * and compute the remaining usable area. Top/bottom bands span the full
 * width; left/right bands sit between them.
 */
export function computeChrome(widgets: TileInstance[]): ChromeLayout {
  let top = 0;
  let bottom = GRID_H;
  let left = 0;
  let right = GRID_W;
  const rects = new Map<string, DropRect>();

  for (const w of widgets.filter((x) => (x.edge ?? "top") === "top")) {
    const th = widgetThickness(w);
    rects.set(w.id, { x: 0, y: top, w: GRID_W, h: th });
    top += th;
  }
  for (const w of widgets.filter((x) => x.edge === "bottom")) {
    const th = widgetThickness(w);
    rects.set(w.id, { x: 0, y: bottom - th, w: GRID_W, h: th });
    bottom -= th;
  }
  for (const w of widgets.filter((x) => x.edge === "left")) {
    const th = widgetThickness(w);
    rects.set(w.id, { x: left, y: top, w: th, h: Math.max(0, bottom - top) });
    left += th;
  }
  for (const w of widgets.filter((x) => x.edge === "right")) {
    const th = widgetThickness(w);
    rects.set(w.id, { x: right - th, y: top, w: th, h: Math.max(0, bottom - top) });
    right -= th;
  }

  const usable: DropRect = {
    x: left,
    y: top,
    w: Math.max(16, right - left),
    h: Math.max(16, bottom - top),
  };
  return { rects, usable };
}

/** The workspace edge nearest to a tile — where "pin to edge" sends it. */
export function nearestEdge(t: TileInstance): EdgeSide {
  const d: [EdgeSide, number][] = [
    ["top", t.y],
    ["bottom", GRID_H - (t.y + t.h)],
    ["left", t.x],
    ["right", GRID_W - (t.x + t.w)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}

/* ------------------------------- projection -------------------------------- */

/** Surface units → pixels, given the workspace pixel box. Endpoint-rounded. */
export function surfaceToPx(r: DropRect, boxW: number, boxH: number): PxRect {
  const sx = boxW / GRID_W;
  const sy = boxH / GRID_H;
  const l = Math.round(r.x * sx);
  const t = Math.round(r.y * sy);
  return {
    left: l,
    top: t,
    width: Math.round((r.x + r.w) * sx) - l,
    height: Math.round((r.y + r.h) * sy) - t,
  };
}

/**
 * Layout units → pixels: the full unit space squeezed into the usable band.
 * `usable` is in surface units; the box is the workspace pixel size.
 */
export function layoutToPx(
  r: DropRect,
  usable: DropRect,
  boxW: number,
  boxH: number,
): PxRect {
  const bandL = (usable.x / GRID_W) * boxW;
  const bandT = (usable.y / GRID_H) * boxH;
  const sx = ((usable.w / GRID_W) * boxW) / GRID_W;
  const sy = ((usable.h / GRID_H) * boxH) / GRID_H;
  const l = Math.round(bandL + r.x * sx);
  const t = Math.round(bandT + r.y * sy);
  return {
    left: l,
    top: t,
    width: Math.round(bandL + (r.x + r.w) * sx) - l,
    height: Math.round(bandT + (r.y + r.h) * sy) - t,
  };
}

/** Pixels → layout units (for pointer math). Continuous, not snapped. */
export function pxToLayoutPoint(
  px: number,
  py: number,
  usable: DropRect,
  boxW: number,
  boxH: number,
): { ux: number; uy: number } {
  const bandL = (usable.x / GRID_W) * boxW;
  const bandT = (usable.y / GRID_H) * boxH;
  const sx = ((usable.w / GRID_W) * boxW) / GRID_W;
  const sy = ((usable.h / GRID_H) * boxH) / GRID_H;
  return { ux: (px - bandL) / sx, uy: (py - bandT) / sy };
}

/** Pixels-per-layout-unit, for converting snap tolerances. */
export function layoutUnitPx(usable: DropRect, boxW: number, boxH: number): { x: number; y: number } {
  return {
    x: ((usable.w / GRID_W) * boxW) / GRID_W,
    y: ((usable.h / GRID_H) * boxH) / GRID_H,
  };
}

/* ------------------------------ normalization ------------------------------ */

/**
 * Scale a tile set vertically so nothing hangs below the fixed surface.
 * Endpoints are scaled together so shared edges stay shared. Used when
 * migrating legacy (unbounded, scrolling) layouts.
 */
export function fitToSurface(tiles: TileInstance[]): TileInstance[] {
  const maxBottom = tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  if (maxBottom <= GRID_H) return tiles;
  const k = GRID_H / maxBottom;
  return tiles.map((t) => {
    const y1 = Math.round(t.y * k);
    const y2 = Math.round((t.y + t.h) * k);
    return { ...t, y: y1, h: Math.max(2, y2 - y1) };
  });
}
