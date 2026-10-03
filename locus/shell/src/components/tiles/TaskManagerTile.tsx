/*
 * Task Manager — the system resource and process monitor (spec §13).
 * ---------------------------------------------------------------------------
 * Not a to-do list. It shows what the OS is running (tiles, scratchpad items,
 * model/indexing activity), what is using memory/power, and gives safe
 * controls: sleep/wake/restart a tile, send it to the Scratchpad, stop it, or
 * flip low-power mode. Browser-measurable numbers are real (frame rate, JS
 * heap where exposed, storage, network); anything estimated says so.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TileProps } from "./registry";
import { effectiveLifecycle } from "./registry";
import { useShell } from "@/core/shell";
import { storage, StoreKeys } from "@/core/storage";
import { indexStatus, runIndex } from "@/core/indexing";
import { getProposals, subscribe as subscribeBroker } from "@/core/broker";
import {
  getCurrentArrangement,
  getScratchpad,
  getLowPower,
  setLowPower,
  subscribe as subscribeDesktop,
  updateTile,
  updateTileSettings,
  sendToScratchpad,
  removeTile,
  tileName,
  tileIcon,
} from "@/core/desktop";

interface PerfSample {
  fps: number;
  heapMB: number | null;
}

function useFrameRate(live: boolean): { fps: number | null; history: PerfSample[] } {
  const [fps, setFps] = useState<number | null>(null);
  const historyRef = useRef<PerfSample[]>([]);
  useEffect(() => {
    if (!live) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      frames += 1;
      if (t - last >= 1000) {
        const f = Math.round((frames * 1000) / (t - last));
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        historyRef.current = [
          ...historyRef.current.slice(-39),
          { fps: f, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null },
        ];
        setFps(f);
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  return { fps, history: historyRef.current };
}

function Spark({ history }: { history: PerfSample[] }) {
  if (history.length < 2) return <p className="faint tilec__hint">Collecting samples…</p>;
  const w = 200;
  const h = 36;
  const pts = history
    .map((s, i) => `${(i / (history.length - 1)) * w},${h - Math.min(1, s.fps / 60) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="tm__spark" role="img" aria-label="Frame rate history">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export function TaskManagerTile({ size, live }: TileProps) {
  const { openApp } = useShell();
  useSyncExternalStore(subscribeDesktop, () => JSON.stringify(getCurrentArrangement().tiles.map((t) => [t.id, t.lifecycle])) + getScratchpad().length + getLowPower());
  const tiles = getCurrentArrangement().tiles.filter((t) => t.kind !== "gap");
  const scratch = getScratchpad();
  const lowPower = getLowPower();

  const proposals = useSyncExternalStore(subscribeBroker, getProposals);
  const running = proposals.filter((p) => p.status === "pending").length;
  const provider = storage.get<string>(StoreKeys.aiProvider, "none");

  const { fps, history } = useFrameRate(live && size !== "tiny");
  const idx = indexStatus();
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number } }).connection;
  const storageMB = (storage.estimateBytes() / 1048576).toFixed(2);
  const liveCount = tiles.filter((t) => effectiveLifecycle(t) === "live").length;
  const sleepCount = tiles.filter((t) => effectiveLifecycle(t) === "sleeping").length;

  const uiLoad = fps === null ? null : Math.max(0, Math.min(100, Math.round(100 - (fps / 60) * 100)));

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">{tiles.length} live</span>
        <span className="faint">{fps !== null ? `${fps} fps` : "system ok"}</span>
      </div>
    );
  }

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: "UI load (est.)", value: uiLoad === null ? "—" : `${uiLoad}%`, warn: uiLoad !== null && uiLoad > 60 },
    {
      label: "Memory",
      value: mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB heap` : `${storageMB} MB stored`,
    },
    { label: "Cores", value: `${navigator.hardwareConcurrency ?? "—"}` },
    {
      label: "Network",
      value: navigator.onLine ? `${conn?.effectiveType ?? "online"}${conn?.downlink ? ` · ${conn.downlink} Mb/s` : ""}` : "offline",
      warn: !navigator.onLine,
    },
    {
      label: "AI",
      value: provider === "none" ? "no model loaded" : `${provider} · ${running} request${running === 1 ? "" : "s"} queued`,
    },
    { label: "Indexing", value: `${idx.indexed}/${idx.total} indexed` },
    { label: "Tiles", value: `${tiles.length} placed · ${liveCount} live · ${sleepCount} sleeping · ${scratch.length} on deck` },
  ];

  if (size === "small") {
    return (
      <div className="tilec tm">
        <ul className="tm__stats">
          {rows.slice(0, 4).map((r) => (
            <li key={r.label} className="tm__stat">
              <span className="faint">{r.label}</span>
              <span className={`mono ${r.warn ? "tm__warn" : ""}`}>{r.value}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="tilec tm">
      <ul className="tm__stats">
        {rows.map((r) => (
          <li key={r.label} className="tm__stat">
            <span className="faint">{r.label}</span>
            <span className={`mono ${r.warn ? "tm__warn" : ""}`}>{r.value}</span>
          </li>
        ))}
      </ul>

      {size === "large" && (
        <>
          <Spark history={history} />
          <p className="eyebrow">Processes</p>
          <ul className="tm__procs">
            {tiles.map((t) => {
              const lc = effectiveLifecycle(t);
              return (
                <li key={t.id} className="tm__proc">
                  <span className="mono tm__proc-icon" aria-hidden>{tileIcon(t)}</span>
                  <span className="tm__proc-name">{tileName(t)}</span>
                  <span className={`chip tm__lc tm__lc--${lc}`}>{lc}</span>
                  <span className="tm__proc-actions">
                    <button
                      className="tilec__link"
                      onClick={() => updateTile(t.id, { lifecycle: lc === "sleeping" ? "live" : "sleeping" })}
                    >
                      {lc === "sleeping" ? "wake" : "sleep"}
                    </button>
                    <button className="tilec__link" onClick={() => updateTileSettings(t.id, { restartNonce: Date.now() })}>
                      restart
                    </button>
                    <button className="tilec__link" onClick={() => sendToScratchpad(t.id)}>hold</button>
                    <button className="tilec__link tm__stop" onClick={() => removeTile(t.id)}>stop</button>
                  </span>
                </li>
              );
            })}
            {scratch.map((s) => (
              <li key={s.id} className="tm__proc tm__proc--scratch">
                <span className="mono tm__proc-icon" aria-hidden>{tileIcon(s.tile)}</span>
                <span className="tm__proc-name">{tileName(s.tile)}</span>
                <span className={`chip tm__lc tm__lc--${s.activity === "active" ? "live" : s.activity === "warm" ? "warm" : "sleeping"}`}>
                  scratchpad · {s.activity}
                </span>
              </li>
            ))}
          </ul>
          <div className="tm__controls">
            <button className={`btn btn--sm ${lowPower ? "btn--primary" : ""}`} onClick={() => setLowPower(!lowPower)}>
              {lowPower ? "Low power: on" : "Low power: off"}
            </button>
            <button className="btn btn--sm btn--ghost" onClick={() => runIndex()}>Index sources now</button>
            <button className="btn btn--sm btn--ghost" onClick={() => openApp("audit-log")}>Audit log →</button>
          </div>
        </>
      )}
      {size === "medium" && (
        <p className="faint tilec__hint">Focus this tile for processes, history, and controls.</p>
      )}
    </div>
  );
}
