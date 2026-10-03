/*
 * Workspace — the fixed spatial operating surface.
 * ---------------------------------------------------------------------------
 * One surface for every mode. Tiles are absolutely positioned from dense unit
 * coordinates and the surface never scrolls (brief §9): units project into
 * whatever pixels the viewport gives, so resizing the window compresses the
 * layout instead of reflowing it. Neighboring tiles share borders — a 1px
 * bleed makes touching hairlines coincide (brief §2). Direct manipulation
 * lives here: pointer move/resize with edge, center, equal-gap and equal-size
 * snapping plus contextual guides (brief §3), placement previews, Scratchpad
 * drops, and right-click customization.
 *
 * Focus is a projection, not a navigation (brief §6): the focused tile's rect
 * grows, every other tile compresses into a band — same elements, so CSS rect
 * transitions carry each tile from one place to the other (FLIP-style spatial
 * continuity, brief §5). Persistent edge widgets render across all of it
 * (brief §8). On narrow screens the same tiles stack in reading order.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DropPlan, DropRect, ResizeEdge, ResizeSide, TileInstance } from "@/types";
import { useMediaQuery } from "@/core/hooks";
import {
  GRID_W,
  GRID_H,
  getDesktop,
  getCurrentArrangement,
  getFocus,
  getFocusedTile,
  getScratchpad,
  getLowPower,
  getWidgets,
  subscribe as subscribeDesktop,
  planDrop,
  clampRect,
  planEdgeResize,
  applyEdgeResize,
  sidesOf,
  applyDrop,
  makeTile,
  focusTile,
  focusDetached,
  defocus,
  sendToScratchpad,
  stashTile,
  removeTile,
  resizeWidget,
  tileIcon,
  tileName,
} from "@/core/desktop";
import {
  computeChrome,
  layoutToPx,
  layoutUnitPx,
  pxToLayoutPoint,
  surfaceToPx,
  widgetThickness,
  type PxRect,
} from "@/core/surface";
import { computeFocusLayout } from "@/core/focusLayout";
import { snapMoveRect, snapResizeBorders, type SnapGuide } from "@/core/snap";
import { modeForPx } from "@/core/tileMeta";
import { DesktopDnDContext, type DragPayload } from "./dnd";
import { TileFrame } from "./TileFrame";
import { TileMenu, type MenuState } from "./TileMenu";
import { TileSettingsDialog } from "./TileSettingsDialog";
import "./workspace.css";

const DRAG_THRESHOLD = 6;
const GHOST_TTL = 260;

interface DragState {
  payload: DragPayload;
  tile: TileInstance;
  offX: number;
  offY: number;
  startPx: number;
  startPy: number;
  px: number;
  py: number;
  started: boolean;
  plan: DropPlan | null;
  guides: SnapGuide[];
  overScratch: boolean;
}

interface ResizeState {
  tile: TileInstance;
  edge: ResizeEdge;
  /** Preview rects for every tile this resize changes (self + shared borders). */
  rects: Map<string, DropRect>;
  guides: SnapGuide[];
}

interface BandResizeState {
  id: string;
  edge: "top" | "bottom" | "left" | "right";
  th: number;
}

/** What a departed tile leaves behind for its exit animation. */
interface LeaveGhost {
  key: string;
  rect: PxRect;
  icon: string;
  name: string;
}

/** Swallow the click that follows a completed drag. */
function suppressNextClick(): void {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, true);
  window.setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

export default function Workspace() {
  useSyncExternalStore(subscribeDesktop, getDesktop);
  const arrangement = getCurrentArrangement();
  const tiles = arrangement.tiles;
  const widgets = getWidgets();
  const lowPower = getLowPower();
  const focus = getFocus();
  const focusActive = focus !== null;
  const wide = useMediaQuery("(min-width: 700px)");
  const interactive = wide && !focusActive;

  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const [bandResize, setBandResize] = useState<BandResizeState | null>(null);
  const bandResizeRef = useRef<BandResizeState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [customize, setCustomize] = useState<TileInstance | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState<LeaveGhost[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const prevSeedsRef = useRef<Map<string, Omit<LeaveGhost, "key">>>(new Map());

  /* ------------------------------ measurement ------------------------------ */

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide]);

  /* ----------------------------- projections -------------------------------- */

  const widgetsPreview = useMemo(() => {
    if (!bandResize) return widgets;
    return widgets.map((w) => {
      if (w.id !== bandResize.id) return w;
      const edge = w.edge ?? "top";
      return edge === "top" || edge === "bottom"
        ? { ...w, h: bandResize.th }
        : { ...w, w: bandResize.th };
    });
  }, [widgets, bandResize]);

  const chrome = useMemo(() => computeChrome(widgetsPreview), [widgetsPreview]);
  const usable = chrome.usable;
  const usableRef = useRef(usable);
  usableRef.current = usable;
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;

  const focusProj = useMemo(
    () => (focus ? computeFocusLayout(tiles, focus) : null),
    [focus, tiles],
  );
  const focusedRenderId = focus?.tileId ?? focus?.tile?.id ?? null;

  const toPx = useCallback(
    (r: DropRect): PxRect => layoutToPx(r, usable, box.w, box.h),
    [usable, box],
  );
  const unitPx = layoutUnitPx(usable, box.w, box.h);
  const tol = Math.min(3, Math.max(1.25, 10 / Math.max(1, Math.min(unitPx.x, unitPx.y))));
  const tolRef = useRef(tol);
  tolRef.current = tol;

  const pointToLayout = useCallback((clientX: number, clientY: number) => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return { ux: 0, uy: 0 };
    return pxToLayoutPoint(
      clientX - r.left,
      clientY - r.top,
      usableRef.current,
      boxRef.current.w,
      boxRef.current.h,
    );
  }, []);

  const isOverScratchpad = useCallback((px: number, py: number): boolean => {
    const el = hostRef.current?.querySelector('[data-tile-kind="scratchpad"]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  }, []);

  /* --------------------------------- drag ---------------------------------- */

  const onDragMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started && Math.hypot(e.clientX - d.startPx, e.clientY - d.startPy) < DRAG_THRESHOLD) return;
      d.started = true;
      d.px = e.clientX;
      d.py = e.clientY;
      d.overScratch =
        d.tile.kind !== "scratchpad" &&
        d.payload.type !== "scratch" &&
        isOverScratchpad(e.clientX, e.clientY);
      if (d.overScratch) {
        d.plan = { kind: "scratchpad", rect: { x: 0, y: 0, w: 0, h: 0 } };
        d.guides = [];
      } else {
        const { ux, uy } = pointToLayout(e.clientX, e.clientY);
        const dragId = d.payload.type === "move" ? d.tile.id : null;
        const snapped = snapMoveRect(
          tilesRef.current,
          dragId,
          { x: ux - d.offX, y: uy - d.offY, w: d.tile.w, h: d.tile.h },
          tolRef.current,
        );
        const rect = clampRect(snapped);
        d.plan = planDrop(tilesRef.current, rect, dragId);
        d.guides = d.plan.kind === "move" || d.plan.kind === "nudge" ? snapped.guides : [];
      }
      setDrag({ ...d });
    },
    [isOverScratchpad, pointToLayout],
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !d.started || !d.plan) return;
    suppressNextClick();
    if (d.plan.kind === "scratchpad") {
      if (d.payload.type === "move") sendToScratchpad(d.tile.id);
      else if (d.payload.type === "add") stashTile(d.tile);
      return;
    }
    applyDrop(
      d.plan,
      d.tile,
      d.payload.type === "scratch" ? { fromScratchId: d.payload.scratchId } : {},
    );
  }, [onDragMove]);

  const beginDrag = useCallback(
    (payload: DragPayload, e: React.PointerEvent) => {
      if (!interactive || e.button !== 0) return;
      let tile: TileInstance | undefined;
      if (payload.type === "move") {
        tile = tilesRef.current.find((t) => t.id === payload.tileId);
      } else if (payload.type === "add") {
        tile = makeTile(payload.kind, {}, payload.app ? { app: payload.app } : {});
      } else {
        tile = getScratchpad().find((i) => i.id === payload.scratchId)?.tile;
      }
      if (!tile) return;
      e.preventDefault();
      const { ux, uy } = pointToLayout(e.clientX, e.clientY);
      const d: DragState = {
        payload,
        tile,
        offX: payload.type === "move" ? ux - tile.x : tile.w / 2,
        offY: payload.type === "move" ? uy - tile.y : tile.h / 2,
        startPx: e.clientX,
        startPy: e.clientY,
        px: e.clientX,
        py: e.clientY,
        started: false,
        plan: null,
        guides: [],
        overScratch: false,
      };
      dragRef.current = d;
      setDrag(d);
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragEnd);
    },
    [interactive, onDragMove, onDragEnd, pointToLayout],
  );

  /* -------------------------------- resize --------------------------------- */

  const onResizeMove = useCallback(
    (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const { ux, uy } = pointToLayout(e.clientX, e.clientY);
      // Any side can move (issue #11): the grip's sides become border targets.
      const sides = sidesOf(r.edge);
      const raw: Partial<Record<ResizeSide, number>> = {};
      if (sides.includes("e")) raw.e = ux;
      if (sides.includes("w")) raw.w = ux;
      if (sides.includes("s")) raw.s = uy;
      if (sides.includes("n")) raw.n = uy;
      const snapped = snapResizeBorders(tilesRef.current, r.tile, raw, tolRef.current);
      const plan = planEdgeResize(tilesRef.current, r.tile.id, snapped.borders);
      const self = plan.rects.get(r.tile.id) ?? r.tile;
      // Guides only survive when the shared-border/blocking clamp kept the snap.
      r.guides = snapped.guides.filter((g) => {
        if (g.axis === "v") {
          const border = snapped.borders.e ?? snapped.borders.w;
          const final = snapped.borders.e !== undefined ? self.x + self.w : self.x;
          return border !== undefined && Math.round(border) === final;
        }
        const border = snapped.borders.s ?? snapped.borders.n;
        const final = snapped.borders.s !== undefined ? self.y + self.h : self.y;
        return border !== undefined && Math.round(border) === final;
      });
      r.rects = plan.rects;
      setResize({ ...r });
    },
    [pointToLayout],
  );

  const onResizeEnd = useCallback(() => {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
    const r = resizeRef.current;
    resizeRef.current = null;
    setResize(null);
    if (!r || r.rects.size === 0) return;
    applyEdgeResize({ rects: r.rects });
  }, [onResizeMove]);

  const beginResize = useCallback(
    (tile: TileInstance, edge: ResizeEdge, e: React.PointerEvent) => {
      if (!interactive || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r: ResizeState = { tile, edge, rects: new Map(), guides: [] };
      resizeRef.current = r;
      setResize(r);
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", onResizeEnd);
    },
    [interactive, onResizeMove, onResizeEnd],
  );

  /* --------------------------- widget band resize --------------------------- */

  const onBandMove = useCallback((e: PointerEvent) => {
    const b = bandResizeRef.current;
    if (!b) return;
    const host = hostRef.current?.getBoundingClientRect();
    const band = chromeRef.current.rects.get(b.id);
    if (!host || !band) return;
    const sx = ((e.clientX - host.left) / boxRef.current.w) * GRID_W;
    const sy = ((e.clientY - host.top) / boxRef.current.h) * GRID_H;
    let th =
      b.edge === "top"
        ? sy - band.y
        : b.edge === "bottom"
          ? band.y + band.h - sy
          : b.edge === "left"
            ? sx - band.x
            : band.x + band.w - sx;
    th =
      b.edge === "top" || b.edge === "bottom"
        ? Math.min(16, Math.max(2, th))
        : Math.min(32, Math.max(6, th));
    b.th = Math.round(th);
    setBandResize({ ...b });
  }, []);

  const onBandEnd = useCallback(() => {
    window.removeEventListener("pointermove", onBandMove);
    window.removeEventListener("pointerup", onBandEnd);
    const b = bandResizeRef.current;
    bandResizeRef.current = null;
    setBandResize(null);
    if (b) resizeWidget(b.id, b.th);
  }, [onBandMove]);

  const beginBandResize = useCallback(
    (tile: TileInstance, e: React.PointerEvent) => {
      if (!wide || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const b: BandResizeState = {
        id: tile.id,
        edge: tile.edge ?? "top",
        th: widgetThickness(tile),
      };
      bandResizeRef.current = b;
      setBandResize(b);
      window.addEventListener("pointermove", onBandMove);
      window.addEventListener("pointerup", onBandEnd);
    },
    [wide, onBandMove, onBandEnd],
  );

  /* ------------------------------ keyboard ---------------------------------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selected) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        removeTile(selected);
        setSelected(null);
      }
      if (e.key === "Enter") focusTile(selected);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  /* ------------------------------- selection -------------------------------- */

  const handleSelect = useCallback(
    (id: string, e?: React.MouseEvent) => {
      // In Focus, clicking a compressed tile leans into it instead.
      if (focusActive && id !== focusedRenderId) {
        const target = e?.target as HTMLElement | undefined;
        if (!target || !target.closest("button, input, a, select, textarea")) {
          focusTile(id);
          return;
        }
      }
      setSelected(id);
    },
    [focusActive, focusedRenderId],
  );

  const openAppsLauncher = useCallback(() => focusDetached(makeTile("apps")), []);
  const dndValue = useMemo(() => ({ beginDrag, canDrag: interactive }), [beginDrag, interactive]);

  /* ------------------------- rendered entry resolution ----------------------- */

  const measured = box.w > 4 && box.h > 4;

  const widgetEntries = useMemo(() => {
    if (!measured || !wide) return [];
    return widgets.flatMap((w) => {
      const band = chrome.rects.get(w.id);
      if (!band || band.h <= 0 || band.w <= 0) return [];
      return [{ tile: w, px: surfaceToPx(band, box.w, box.h) }];
    });
  }, [measured, wide, widgets, chrome, box]);

  const tileEntries = useMemo(() => {
    if (!measured || !wide) return [];
    return tiles.flatMap((t) => {
      let unit: DropRect | null;
      if (focusProj) {
        unit = focusProj.rects.get(t.id) ?? null; // gaps vanish in Focus
      } else if (resize?.rects.has(t.id)) {
        // Shared borders move for every involved tile (issue #11).
        unit = resize.rects.get(t.id)!;
      } else {
        unit = { x: t.x, y: t.y, w: t.w, h: t.h };
      }
      if (!unit) return [];
      return [{ tile: t, px: toPx(unit), focused: focusedRenderId === t.id }];
    });
  }, [measured, wide, tiles, focusProj, resize, toPx, focusedRenderId]);

  const detachedEntry = useMemo(() => {
    if (!measured || !wide || !focus?.tile || !focusProj) return null;
    return { tile: focus.tile, px: toPx(focusProj.focusRect), focused: true };
  }, [measured, wide, focus, focusProj, toPx]);

  /* --------------------- enter / leave animation tracking -------------------- */

  const renderedSeeds: [string, Omit<LeaveGhost, "key">][] = wide
    ? [...widgetEntries, ...tileEntries, ...(detachedEntry ? [detachedEntry] : [])].map((e) => [
        e.tile.id,
        { rect: e.px, icon: tileIcon(e.tile), name: tileName(e.tile) },
      ])
    : [];

  useEffect(() => {
    if (!wide || !measured) {
      prevSeedsRef.current = new Map();
      return;
    }
    const current = new Map(renderedSeeds);
    const prev = prevSeedsRef.current;
    prevSeedsRef.current = current;
    const gone: LeaveGhost[] = [];
    prev.forEach((seed, id) => {
      if (!current.has(id)) gone.push({ ...seed, key: `${id}:${Date.now()}` });
    });
    for (const [id] of current) seenRef.current.add(id);
    if (gone.length) {
      setGhosts((g) => [...g, ...gone]);
      const keys = new Set(gone.map((g) => g.key));
      window.setTimeout(() => setGhosts((g) => g.filter((x) => !keys.has(x.key))), GHOST_TTL);
    }
  });

  /* ----------------------------- stacked (phone) ----------------------------- */

  if (!wide) {
    const focusedTile = getFocusedTile();
    const stackedTiles = [...tiles]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .filter((t) => t.kind !== "gap");
    const scratchItems = getScratchpad();
    const stackedMode = (t: TileInstance) => (t.h <= 8 ? "mini" : t.h <= 16 ? "compact" : "full");

    return (
      <DesktopDnDContext.Provider value={dndValue}>
        <div className="workspace workspace--stacked">
          {focusActive && focusedTile ? (
            <div className="workspace__stackfocus">
              <TileFrame
                tile={focusedTile}
                mode="full"
                focused
                lowPower={lowPower}
                selected={false}
                dragging={false}
                replaceTarget={false}
                interactive={false}
                onSelect={handleSelect}
                onFocus={focusTile}
                onDefocus={defocus}
                onMenu={(t, x, y) => setMenu({ tile: t, x, y })}
                onDragStart={() => {}}
                onResizeStart={() => {}}
              />
            </div>
          ) : (
            <>
              {widgets.map((w) => (
                <div className="workspace__stackwidget" key={w.id}>
                  <TileFrame
                    tile={w}
                    mode="compact"
                    isWidget
                    lowPower={lowPower}
                    selected={false}
                    dragging={false}
                    replaceTarget={false}
                    interactive={false}
                    onSelect={handleSelect}
                    onFocus={focusTile}
                    onMenu={(t, x, y) => setMenu({ tile: t, x, y, widget: true })}
                    onDragStart={() => {}}
                    onResizeStart={() => {}}
                  />
                </div>
              ))}
              <div className="workspace__stack">
                {stackedTiles.map((tile) => (
                  <TileFrame
                    key={tile.id}
                    tile={tile}
                    mode={stackedMode(tile)}
                    lowPower={lowPower}
                    selected={selected === tile.id}
                    dragging={false}
                    replaceTarget={false}
                    interactive={false}
                    onSelect={handleSelect}
                    onFocus={focusTile}
                    onMenu={(t, x, y) => setMenu({ tile: t, x, y })}
                    onDragStart={() => {}}
                    onResizeStart={() => {}}
                  />
                ))}
              </div>
              {scratchItems.length > 0 && (
                <div className="workspace__shelf" aria-label="Scratchpad shelf">
                  <span className="eyebrow">Scratchpad</span>
                  {scratchItems.map((i) => (
                    <button
                      key={i.id}
                      className="chip workspace__shelf-item"
                      onClick={() => focusDetached(i.tile, i.id)}
                    >
                      <span className="mono" aria-hidden>{tileIcon(i.tile)}</span> {tileName(i.tile)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {menu && (
            <TileMenu menu={menu} onClose={() => setMenu(null)} onCustomize={setCustomize} onOpenApps={openAppsLauncher} />
          )}
          {customize && <TileSettingsDialog tile={customize} onClose={() => setCustomize(null)} />}
        </div>
      </DesktopDnDContext.Provider>
    );
  }

  /* ------------------------------ spatial surface ---------------------------- */

  const plan = drag?.started && !drag.overScratch ? drag.plan : null;
  const nudges = new Map<string, { dx: number; dy: number }>();
  if (plan?.kind === "nudge") {
    for (const mv of plan.moves) {
      const t = tiles.find((x) => x.id === mv.id);
      if (t) nudges.set(mv.id, { dx: (mv.x - t.x) * unitPx.x, dy: (mv.y - t.y) * unitPx.y });
    }
  }
  const replaceTargetId = plan?.kind === "replace" ? plan.targetId : null;

  const ghostLabel =
    plan?.kind === "replace"
      ? `Replace ${tileName(tiles.find((t) => t.id === plan.targetId) ?? drag!.tile)} with ${tileName(drag!.tile)}?`
      : plan?.kind === "nudge"
        ? "Insert here — neighbors make room"
        : plan?.kind === "fill-gap"
          ? "Fill this held space"
          : plan?.kind === "invalid"
            ? "No room here"
            : "Place here";

  const activeGuides: SnapGuide[] =
    drag?.started && !drag.overScratch ? drag.guides : resize ? resize.guides : [];

  return (
    <DesktopDnDContext.Provider value={dndValue}>
      <div
        ref={hostRef}
        className={[
          "workspace",
          drag?.started ? "is-drag-active" : "",
          drag?.overScratch ? "workspace--scratch-hover" : "",
          focusActive ? "workspace--focus" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".tile")) return;
          e.preventDefault();
          const { ux, uy } = pointToLayout(e.clientX, e.clientY);
          setMenu({ x: e.clientX, y: e.clientY, cell: { x: Math.floor(ux), y: Math.floor(uy) } });
        }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest(".tile")) setSelected(null);
        }}
      >
        {measured && (
          <>
            {widgetEntries.map(({ tile, px }) => (
              <TileFrame
                key={tile.id}
                tile={tile}
                rect={px}
                mode={modeForPx(px.width, px.height)}
                isWidget
                lowPower={lowPower}
                selected={selected === tile.id}
                dragging={false}
                replaceTarget={false}
                entering={!seenRef.current.has(tile.id)}
                manipulating={bandResize?.id === tile.id}
                interactive={wide}
                onSelect={handleSelect}
                onFocus={focusTile}
                onMenu={(t, x, y) => setMenu({ tile: t, x, y, widget: true })}
                onDragStart={() => {}}
                onResizeStart={() => {}}
                onWidgetResizeStart={beginBandResize}
              />
            ))}

            {tileEntries.map(({ tile, px, focused }) => (
              <TileFrame
                key={tile.id}
                tile={tile}
                rect={px}
                mode={focused ? "full" : modeForPx(px.width, px.height)}
                focused={focused}
                lowPower={lowPower}
                selected={selected === tile.id}
                dragging={Boolean(drag?.started && drag.payload.type === "move" && drag.tile.id === tile.id)}
                replaceTarget={tile.id === replaceTargetId}
                nudge={nudges.get(tile.id)}
                entering={!seenRef.current.has(tile.id)}
                manipulating={resize?.rects.has(tile.id) ?? false}
                interactive={interactive}
                onSelect={handleSelect}
                onFocus={focusTile}
                onDefocus={defocus}
                onMenu={(t, x, y) => setMenu({ tile: t, x, y })}
                onDragStart={(t, e) => beginDrag({ type: "move", tileId: t.id }, e)}
                onResizeStart={beginResize}
              />
            ))}

            {detachedEntry && (
              <TileFrame
                key={detachedEntry.tile.id}
                tile={detachedEntry.tile}
                rect={detachedEntry.px}
                mode="full"
                focused
                lowPower={lowPower}
                selected={false}
                dragging={false}
                replaceTarget={false}
                entering={!seenRef.current.has(detachedEntry.tile.id)}
                interactive={false}
                onSelect={handleSelect}
                onFocus={focusTile}
                onDefocus={defocus}
                onMenu={(t, x, y) => setMenu({ tile: t, x, y })}
                onDragStart={() => {}}
                onResizeStart={() => {}}
              />
            )}

            {/* Exit animations: departed tiles fade from where they were. */}
            {ghosts.map((g) => (
              <div
                key={g.key}
                className="workspace__leave"
                style={{ left: g.rect.left, top: g.rect.top, width: g.rect.width, height: g.rect.height }}
                aria-hidden
              >
                <span className="mono">{g.icon}</span>
                <span className="workspace__leave-name">{g.name}</span>
              </div>
            ))}

            {tiles.length === 0 && !focusActive && (
              <div className="workspace__empty">
                <p className="muted">The workspace is empty.</p>
                <button className="btn" onClick={openAppsLauncher}>Add tiles from Apps</button>
              </div>
            )}

            {/* Alignment / spacing / size guides (brief §3). */}
            {activeGuides.map((g, i) => {
              if (g.kind === "size" && g.rect) {
                const px = toPx(g.rect);
                return (
                  <div
                    key={`g${i}`}
                    className="workspace__guide-size"
                    style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
                    aria-hidden
                  />
                );
              }
              const px =
                g.axis === "v"
                  ? toPx({ x: g.pos, y: g.from, w: 0, h: g.to - g.from })
                  : toPx({ x: g.from, y: g.pos, w: g.to - g.from, h: 0 });
              return (
                <div
                  key={`g${i}`}
                  className={`workspace__guide workspace__guide--${g.axis} workspace__guide--${g.kind}`}
                  style={
                    g.axis === "v"
                      ? { left: px.left, top: px.top, height: px.height }
                      : { left: px.left, top: px.top, width: px.width }
                  }
                  aria-hidden
                />
              );
            })}

            {/* Placement preview (move / insert-nudge / replace / fill-gap / invalid). */}
            {plan && (
              <div
                className={`workspace__ghost workspace__ghost--${plan.kind}`}
                style={(() => {
                  const px = toPx(plan.rect);
                  return { left: px.left, top: px.top, width: px.width, height: px.height };
                })()}
                aria-hidden
              >
                <span className="workspace__ghost-label">{ghostLabel}</span>
              </div>
            )}
          </>
        )}

        {/* Carry chip following the pointer for add / scratch drags. */}
        {drag?.started && drag.payload.type !== "move" && (
          <div className="workspace__carry mono" style={{ left: drag.px + 12, top: drag.py + 12 }} aria-hidden>
            {tileIcon(drag.tile)} {tileName(drag.tile)}
          </div>
        )}
        {drag?.started && drag.overScratch && (
          <div className="workspace__carry workspace__carry--scratch" style={{ left: drag.px + 12, top: drag.py + 36 }} aria-hidden>
            Hold in Scratchpad
          </div>
        )}

        {menu && (
          <TileMenu menu={menu} onClose={() => setMenu(null)} onCustomize={setCustomize} onOpenApps={openAppsLauncher} />
        )}
        {customize && <TileSettingsDialog tile={customize} onClose={() => setCustomize(null)} />}
      </div>
    </DesktopDnDContext.Provider>
  );
}
