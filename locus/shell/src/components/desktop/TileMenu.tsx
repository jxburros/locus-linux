/*
 * TileMenu — right-click / long-press customization (spec §14).
 * ---------------------------------------------------------------------------
 * One small fixed-position menu for tiles (focus, rename, accent, AI
 * visibility, lifecycle, scratchpad, pin-to-edge, remove / remove-and-hold),
 * for persistent edge widgets (move between edges, unpin, remove), and for
 * empty surface space (hold this space, add tiles, freeform). Most
 * customization stays direct — drag and resize never come through here.
 */

import { useEffect, useRef } from "react";
import type { EdgeSide, TileInstance } from "@/types";
import {
  focusTile,
  holdGap,
  removeTile,
  sendToScratchpad,
  updateTile,
  tileName,
  enterFreeform,
  getMode,
  pinTileToEdge,
  unpinWidget,
  moveWidgetToEdge,
  removeWidget,
  shuffleTiles,
} from "@/core/desktop";
import { effectiveLifecycle } from "../tiles/registry";

export interface MenuState {
  x: number;
  y: number;
  tile?: TileInstance;
  /** Set when the tile is a persistent edge widget, not a placed tile. */
  widget?: boolean;
  /** Set for empty-surface menus: the layout cell under the pointer. */
  cell?: { x: number; y: number };
}

interface TileMenuProps {
  menu: MenuState;
  onClose: () => void;
  onCustomize: (tile: TileInstance) => void;
  onOpenApps: () => void;
}

const EDGES: EdgeSide[] = ["top", "bottom", "left", "right"];

export function TileMenu({ menu, onClose, onCustomize, onOpenApps }: TileMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen.
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 240),
    top: Math.min(menu.y, window.innerHeight - 360),
  };

  const t = menu.tile;
  const lifecycle = t ? effectiveLifecycle(t) : "warm";

  function run(fn: () => void) {
    fn();
    onClose();
  }

  if (t && menu.widget) {
    return (
      <div className="tmenu" style={style} role="menu" ref={ref}>
        <p className="tmenu__title">{tileName(t)} · edge widget</p>
        <button className="tmenu__item" role="menuitem" onClick={() => run(() => onCustomize(t))}>
          Customize…
        </button>
        <div className="tmenu__row" role="group" aria-label="Widget edge">
          {EDGES.map((edge) => (
            <button
              key={edge}
              className={`tmenu__chip ${(t.edge ?? "top") === edge ? "is-active" : ""}`}
              onClick={() => run(() => moveWidgetToEdge(t.id, edge))}
            >
              {edge}
            </button>
          ))}
        </div>
        <hr className="tmenu__sep" />
        <button className="tmenu__item" role="menuitem" onClick={() => run(() => unpinWidget(t.id))}>
          Unpin — place as a normal tile
        </button>
        <button
          className="tmenu__item tmenu__item--danger"
          role="menuitem"
          onClick={() => run(() => removeWidget(t.id))}
        >
          Remove widget
        </button>
        <p className="tmenu__hint faint">
          Edge widgets persist across views and reserve their band. Removed widgets come back from Apps.
        </p>
      </div>
    );
  }

  return (
    <div className="tmenu" style={style} role="menu" ref={ref}>
      {t ? (
        <>
          <p className="tmenu__title">{tileName(t)}</p>
          {t.kind !== "gap" && (
            <>
              <button className="tmenu__item" role="menuitem" onClick={() => run(() => focusTile(t.id))}>
                Focus
              </button>
              <button className="tmenu__item" role="menuitem" onClick={() => run(() => onCustomize(t))}>
                Customize…
              </button>
              <button
                className="tmenu__item"
                role="menuitem"
                onClick={() => run(() => updateTile(t.id, { accent: !t.accent }))}
              >
                {t.accent ? "Remove accent highlight" : "Accent highlight"}
              </button>
              <button
                className="tmenu__item"
                role="menuitem"
                onClick={() => run(() => updateTile(t.id, { aiVisible: t.aiVisible === false }))}
              >
                {t.aiVisible === false ? "Show to AI" : "Hide from AI"}
              </button>
              <div className="tmenu__row" role="group" aria-label="Tile lifecycle">
                {(["live", "warm", "sleeping"] as const).map((lc) => (
                  <button
                    key={lc}
                    className={`tmenu__chip ${lifecycle === lc ? "is-active" : ""}`}
                    onClick={() => run(() => updateTile(t.id, { lifecycle: lc }))}
                  >
                    {lc}
                  </button>
                ))}
              </div>
              <hr className="tmenu__sep" />
              <button className="tmenu__item" role="menuitem" onClick={() => run(() => pinTileToEdge(t.id))}>
                Pin to edge — persist across views
              </button>
              <button className="tmenu__item" role="menuitem" onClick={() => run(() => sendToScratchpad(t.id))}>
                Send to Scratchpad
              </button>
              <button
                className="tmenu__item"
                role="menuitem"
                onClick={() => run(() => removeTile(t.id, { holdGap: true }))}
              >
                Remove &amp; hold the space
              </button>
            </>
          )}
          <button
            className="tmenu__item tmenu__item--danger"
            role="menuitem"
            onClick={() => run(() => removeTile(t.id))}
          >
            {t.kind === "gap" ? "Release held space" : "Remove tile"}
          </button>
          {t.kind !== "gap" && (
            <p className="tmenu__hint faint">Removed tiles can be returned from Apps.</p>
          )}
        </>
      ) : (
        <>
          <p className="tmenu__title">Workspace</p>
          {menu.cell && (
            <button className="tmenu__item" role="menuitem" onClick={() => run(() => holdGap(menu.cell!))}>
              Hold this space
            </button>
          )}
          <button className="tmenu__item" role="menuitem" onClick={() => run(onOpenApps)}>
            Add a tile…
          </button>
          <button className="tmenu__item" role="menuitem" onClick={() => run(shuffleTiles)}>
            Shuffle — repack with no gaps
          </button>
          {getMode() !== "freeform" && (
            <button className="tmenu__item" role="menuitem" onClick={() => run(enterFreeform)}>
              Enter Freeform
            </button>
          )}
        </>
      )}
    </div>
  );
}
