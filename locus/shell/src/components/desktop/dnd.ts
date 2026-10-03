/*
 * Desktop drag-and-drop context.
 * ---------------------------------------------------------------------------
 * The Desktop canvas owns the pointer choreography; tile contents (the Apps
 * launcher, the Scratchpad) only need a way to *start* a drag with a payload.
 * Outside the canvas (Focus View, stacked mobile layout) the default context
 * is a no-op, so tiles never need to know where they are rendered.
 */

import { createContext, useContext } from "react";
import type { AppId, TileKind } from "@/types";

export type DragPayload =
  | { type: "move"; tileId: string }
  | { type: "add"; kind: TileKind; app?: AppId }
  | { type: "scratch"; scratchId: string };

export interface DesktopDnD {
  /** Begin a drag from a pointerdown event. No-op outside the canvas. */
  beginDrag: (payload: DragPayload, e: React.PointerEvent) => void;
  /** Whether direct manipulation is available here (false on stacked mobile). */
  canDrag: boolean;
}

export const DesktopDnDContext = createContext<DesktopDnD>({
  beginDrag: () => {},
  canDrag: false,
});

export function useDesktopDnD(): DesktopDnD {
  return useContext(DesktopDnDContext);
}
