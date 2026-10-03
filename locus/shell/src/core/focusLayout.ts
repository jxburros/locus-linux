/*
 * Focus layout — Focus as a transformation of the Dashboard (brief §6).
 * ---------------------------------------------------------------------------
 * Focus does not navigate away: it re-projects the current arrangement. The
 * focused tile grows into a large slot; every other tile compresses into a
 * band along the right edge, in reading order, sized so it stays identifiable
 * (presentation modes take over as tiles get small). Held gaps disappear —
 * reserved emptiness has no meaning while leaning in.
 *
 * Everything stays in layout units, so the renderer animates tiles from their
 * placed rects into the projection and back — the user never loses the sense
 * of place.
 */

import { GRID_H, GRID_W } from "./tileMeta";
import type { DropRect, FocusTarget, TileInstance } from "@/types";

/** Width of one compressed column, in layout units. */
const BAND_COL_W = 13;
/** Below this row height the band grows a second (then third) column. */
const MIN_ROW_H = 6;
const MAX_COLS = 3;

export interface FocusProjection {
  /** Layout-space rects for every tile visible in Focus (id → rect). */
  rects: Map<string, DropRect>;
  /** The large slot the focused tile occupies. */
  focusRect: DropRect;
}

export function computeFocusLayout(
  tiles: TileInstance[],
  focus: FocusTarget,
): FocusProjection {
  const focusedId = focus.tileId ?? focus.tile?.id ?? null;
  const others = tiles
    .filter((t) => t.id !== focusedId && t.kind !== "gap")
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rects = new Map<string, DropRect>();

  if (others.length === 0) {
    const focusRect = { x: 0, y: 0, w: GRID_W, h: GRID_H };
    if (focusedId) rects.set(focusedId, focusRect);
    return { rects, focusRect };
  }

  const maxRows = Math.max(1, Math.floor(GRID_H / MIN_ROW_H));
  const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(others.length / maxRows)));
  const rows = Math.ceil(others.length / cols);
  const band = Math.min(BAND_COL_W * cols, Math.round(GRID_W * 0.34));
  const bandX = GRID_W - band;

  others.forEach((t, i) => {
    const c = Math.floor(i / rows);
    const r = i % rows;
    // Endpoint rounding keeps stacked tiles sharing borders exactly.
    const x1 = bandX + Math.round((c * band) / cols);
    const x2 = bandX + Math.round(((c + 1) * band) / cols);
    const y1 = Math.round((r * GRID_H) / rows);
    const y2 = Math.round(((r + 1) * GRID_H) / rows);
    rects.set(t.id, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  });

  const focusRect = { x: 0, y: 0, w: bandX, h: GRID_H };
  if (focusedId) rects.set(focusedId, focusRect);
  return { rects, focusRect };
}
