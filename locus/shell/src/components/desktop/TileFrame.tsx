/*
 * TileFrame — the chrome around every placed tile.
 * ---------------------------------------------------------------------------
 * Header (icon, label, focus + menu), the adaptive content, resize handles,
 * and the visual states: normal, hover, selected, dragged, drop-replace
 * target, sleeping, gap, focused, widget. Tiles are the operating surface —
 * the frame stays hairline-thin and calm.
 *
 * Presentation modes (brief §10) come from rendered pixels, not units:
 *   full    → header + rich content
 *   compact → header + minimal content
 *   mini    → micro header + tiny content
 *   icon    → a glyph; just enough to stay identifiable
 *
 * When focused, the tile *is* the app surface: the full app renders inside
 * the tile body and the header grows a back control. Chromeless kinds (the
 * Home widget) draw no header — their content is its own chrome.
 */

import { memo, useRef } from "react";
import type { ResizeEdge, TileInstance, TileMode } from "@/types";
import { contentSizeForMode, TILE_META } from "@/core/tileMeta";
import { getFocus, getActiveLayout, tileIcon, tileName } from "@/core/desktop";
import { getApp } from "@/core/appRegistry";
import type { PxRect } from "@/core/surface";
import { TileContent, effectiveLifecycle } from "../tiles/registry";

export type { ResizeEdge };

/** Every side and corner is a grip (issue #11). */
const RESIZE_EDGES: ResizeEdge[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

/** Resolve which registry app fills this tile's Focus slot, if any. */
function slotAppFor(tile: TileInstance) {
  if (tile.kind === "app" && tile.app) return getApp(tile.app);
  if (tile.kind !== "app" && tile.kind !== "gap" && tile.kind !== "devwidget") {
    const focusApp = TILE_META[tile.kind].focusApp;
    if (focusApp) return getApp(focusApp);
  }
  return undefined;
}

interface TileFrameProps {
  tile: TileInstance;
  /** Absolute pixel rect on the spatial surface (undefined in stacked flow). */
  rect?: PxRect;
  mode: TileMode;
  /** This tile fills the Focus slot: app content + back control. */
  focused?: boolean;
  /** Rendered as a persistent edge widget: no drag, focus, or free resize. */
  isWidget?: boolean;
  lowPower: boolean;
  selected: boolean;
  /** This tile is being dragged (its origin stays visible but lifted). */
  dragging: boolean;
  /** A drag hovers over this tile and would replace it. */
  replaceTarget: boolean;
  /** Preview offset (px) while a neighbor-nudge is being previewed. */
  nudge?: { dx: number; dy: number };
  /** Newly placed this render — plays the enter animation. */
  entering?: boolean;
  /** Under direct manipulation: rect transitions off so it tracks the pointer. */
  manipulating?: boolean;
  interactive: boolean;
  onSelect: (id: string, e?: React.MouseEvent) => void;
  onFocus: (id: string) => void;
  onDefocus?: () => void;
  onMenu: (tile: TileInstance, x: number, y: number) => void;
  onDragStart: (tile: TileInstance, e: React.PointerEvent) => void;
  onResizeStart: (tile: TileInstance, edge: ResizeEdge, e: React.PointerEvent) => void;
  /** Widgets resize their band thickness from the inner edge. */
  onWidgetResizeStart?: (tile: TileInstance, e: React.PointerEvent) => void;
}

function TileFrameInner({
  tile,
  rect,
  mode,
  focused,
  isWidget,
  lowPower,
  selected,
  dragging,
  replaceTarget,
  nudge,
  entering,
  manipulating,
  interactive,
  onSelect,
  onFocus,
  onDefocus,
  onMenu,
  onDragStart,
  onResizeStart,
  onWidgetResizeStart,
}: TileFrameProps) {
  const longPress = useRef<number | null>(null);
  const lifecycle = effectiveLifecycle(tile);
  const isGap = tile.kind === "gap";
  const live = lifecycle === "live" && !isGap;
  const slow = lifecycle === "warm" || lowPower;
  const chromeless =
    tile.kind !== "gap" &&
    tile.kind !== "app" &&
    tile.kind !== "devwidget" &&
    TILE_META[tile.kind].chromeless === true;
  const app = focused ? slotAppFor(tile) : undefined;
  const AppComponent = app?.component;

  const effMode: TileMode = focused ? "full" : mode;
  const contentSize = focused
    ? "large"
    : contentSizeForMode(effMode, rect?.width ?? 480, rect?.height ?? 320);

  const classes = [
    "tile",
    `tile--${effMode}`,
    isGap ? "tile--gap" : "",
    chromeless ? "tile--chromeless" : "",
    isWidget ? "tile--widget" : "",
    focused ? "is-focused" : "",
    selected ? "is-selected" : "",
    dragging ? "is-dragging" : "",
    replaceTarget ? "is-replace-target" : "",
    nudge ? "is-nudging" : "",
    entering ? "is-entering" : "",
    manipulating ? "is-manipulating" : "",
    lifecycle === "sleeping" ? "is-sleeping" : "",
    tile.accent ? "tile--accent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function startLongPress(e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    const { clientX, clientY } = e;
    longPress.current = window.setTimeout(() => onMenu(tile, clientX, clientY), 550);
  }
  function cancelLongPress() {
    if (longPress.current) window.clearTimeout(longPress.current);
    longPress.current = null;
  }

  /** Chromeless tiles drag from anywhere that is not a control. */
  function surfaceDragStart(e: React.PointerEvent) {
    cancelLongPress();
    if (!interactive || isWidget || focused || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, a, select, textarea, [data-no-drag]")) return;
    onDragStart(tile, e);
  }

  const canManipulate = interactive && !isWidget && !focused;
  const showHeader = !isGap && !chromeless && effMode !== "icon";
  const focusOrigin = focused ? describeFocusOrigin() : null;

  return (
    <section
      className={classes}
      style={
        rect
          ? {
              // +1px bleed merges the border with any neighbor sharing this edge.
              left: rect.left,
              top: rect.top,
              width: rect.width + 1,
              height: rect.height + 1,
              transform: nudge ? `translate(${nudge.dx}px, ${nudge.dy}px)` : undefined,
            }
          : undefined
      }
      data-tile-id={tile.id}
      data-tile-kind={tile.kind}
      aria-label={tileName(tile)}
      title={effMode === "icon" ? tileName(tile) : undefined}
      onClick={(e) => onSelect(tile.id, e)}
      onDoubleClick={() => !isGap && !isWidget && !focused && onFocus(tile.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(tile, e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        startLongPress(e);
        if (chromeless || effMode === "icon") surfaceDragStart(e);
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerMove={cancelLongPress}
    >
      {showHeader && (
        <header
          className="tile__head"
          onPointerDown={(e) => {
            cancelLongPress();
            if (canManipulate && e.button === 0) onDragStart(tile, e);
          }}
          title={canManipulate ? "Drag to move" : undefined}
        >
          {focused && (
            <button
              className="tile__back"
              onClick={(e) => {
                e.stopPropagation();
                onDefocus?.();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Leave Focus (Esc)"
            >
              ‹ Back
            </button>
          )}
          <span className="tile__icon mono" aria-hidden>{tileIcon(tile)}</span>
          <h3 className="tile__name">{app?.name ?? tileName(tile)}</h3>
          {focused && focusOrigin && effMode === "full" && (
            <span className="tile__origin faint">{focusOrigin}</span>
          )}
          {lifecycle !== "live" && !focused && (
            <span className={`tile__lc tile__lc--${lifecycle}`} title={`Tile is ${lifecycle}`} />
          )}
          {!focused && !isWidget && (
            <button
              className="tile__ctl"
              onClick={(e) => {
                e.stopPropagation();
                onFocus(tile.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`Focus ${tileName(tile)}`}
              title="Focus"
            >
              ⤢
            </button>
          )}
          <button
            className="tile__ctl"
            onClick={(e) => {
              e.stopPropagation();
              onMenu(tile, e.clientX, e.clientY);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Options for ${tileName(tile)}`}
            title="Customize"
          >
            ⋯
          </button>
        </header>
      )}

      {effMode === "icon" && !isGap ? (
        <div className="tile__iconface" aria-hidden>
          <span className="mono">{tileIcon(tile)}</span>
        </div>
      ) : (
        <div className="tile__body" key={String(tile.settings?.restartNonce ?? "")}>
          {focused && AppComponent ? (
            <div className="tile__app">
              <AppComponent />
            </div>
          ) : (
            <TileContent
              tile={tile}
              size={contentSize}
              focused={focused}
              live={live || lifecycle === "warm"}
              slow={slow}
              px={rect ? { w: rect.width, h: rect.height } : undefined}
            />
          )}
        </div>
      )}

      {replaceTarget && (
        <div className="tile__replace-veil" aria-hidden>
          <span>Replace {tileName(tile)}?</span>
        </div>
      )}

      {canManipulate &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`tile__resize tile__resize--${edge}`}
            onPointerDown={(e) => onResizeStart(tile, edge, e)}
            aria-hidden
          />
        ))}

      {isWidget && interactive && onWidgetResizeStart && (
        <div
          className={`tile__resize tile__resize--band tile__resize--band-${tile.edge ?? "top"}`}
          onPointerDown={(e) => onWidgetResizeStart(tile, e)}
          title="Drag to adjust the band"
          aria-hidden
        />
      )}
    </section>
  );
}

function describeFocusOrigin(): string {
  const focus = getFocus();
  if (!focus) return "";
  if (focus.scratchId) return "from the Scratchpad";
  if (focus.tileId) {
    const layout = getActiveLayout();
    return `placed on ${layout.builtIn ? "the Dashboard" : layout.name}`;
  }
  return "not placed — return it from Apps or hold it in the Scratchpad";
}

export const TileFrame = memo(TileFrameInner);
