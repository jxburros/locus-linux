/*
 * Display-oriented Anchors: Clock, Battery, Photo, Weather.
 * ---------------------------------------------------------------------------
 * Anchors display; widgets do. These tiles aggregate and present, scale their
 * density with size (spec §12), and are honest about their data: the weather
 * anchor is a deterministic local demo until a real source is connected, and
 * says so.
 */

import { useEffect, useMemo, useState } from "react";
import type { TileProps } from "./registry";
import { cadence } from "./registry";
import { useTileNow } from "@/core/hooks";
import { updateTileSettings, setLowPower, getLowPower, subscribe as subscribeDesktop } from "@/core/desktop";
import { getHourCycle } from "@/core/cores/time";
import { useSyncExternalStore } from "react";

/* ---------------------------------- Clock ---------------------------------- */

export function ClockTile({ size, live, slow }: TileProps) {
  const seconds = size === "large" || size === "medium";
  const now = useTileNow(cadence(seconds ? 1000 : 15000, slow), live);
  // Time Core owns the 12/24h preference — the shell clock honors it.
  const hc = getHourCycle();
  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds && size === "large" ? { second: "2-digit" } : {}),
    ...(hc === "auto" ? {} : { hour12: hc === "12" }),
  });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">{time}</span>
      </div>
    );
  }
  return (
    <div className="tilec tilec--center">
      <span className={`mono ${size === "large" ? "tilec__huge" : "tilec__big"}`}>{time}</span>
      <span className="muted">{date}</span>
      {size === "large" && (
        <span className="faint tilec__hint mono">
          {Intl.DateTimeFormat().resolvedOptions().timeZone} · week{" "}
          {Math.ceil(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7)}
        </span>
      )}
    </div>
  );
}

/* --------------------------------- Battery --------------------------------- */

interface BatteryManager {
  level: number;
  charging: boolean;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

function useBattery(): { level: number; charging: boolean } | null | undefined {
  // undefined = still resolving, null = unsupported.
  const [state, setState] = useState<{ level: number; charging: boolean } | null | undefined>(undefined);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) {
      setState(null);
      return;
    }
    let bat: BatteryManager | null = null;
    let disposed = false;
    const read = () => bat && setState({ level: bat.level, charging: bat.charging });
    nav.getBattery().then((b) => {
      if (disposed) return;
      bat = b;
      read();
      b.addEventListener("levelchange", read);
      b.addEventListener("chargingchange", read);
    });
    return () => {
      disposed = true;
      if (bat) {
        bat.removeEventListener("levelchange", read);
        bat.removeEventListener("chargingchange", read);
      }
    };
  }, []);
  return state;
}

export function BatteryTile({ size }: TileProps) {
  const battery = useBattery();
  const lowPower = useSyncExternalStore(subscribeDesktop, getLowPower);

  const pct = battery ? Math.round(battery.level * 100) : null;
  const label =
    battery === undefined
      ? "…"
      : battery === null
        ? "—"
        : `${pct}%`;
  const detail =
    battery === null
      ? "Power state unavailable here"
      : battery?.charging
        ? "Charging"
        : "On battery";

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">
          {battery?.charging ? "↯" : "▮"} {label}
        </span>
      </div>
    );
  }
  return (
    <div className="tilec tilec--center">
      <span className={`mono ${size === "large" ? "tilec__huge" : "tilec__big"}`}>{label}</span>
      <span className="muted">{detail}</span>
      {pct !== null && (
        <div className="battery__bar" role="img" aria-label={`Battery ${pct} percent`}>
          <div className="battery__fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(size === "medium" || size === "large") && (
        <button
          className={`btn btn--sm ${lowPower ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setLowPower(!lowPower)}
        >
          {lowPower ? "Low-power mode on" : "Enable low-power mode"}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------- Photo ---------------------------------- */
/* Does nothing except display an image. Personal visual customization matters. */

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function PhotoTile({ tile, size }: TileProps) {
  const src = tile.settings?.src as string | undefined;
  const caption = tile.settings?.caption as string | undefined;
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      updateTileSettings(tile.id, { src: url });
      setErr(null);
    } catch {
      setErr("Could not read that image.");
    }
  }

  if (!src) {
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="faint" aria-hidden>▣</span>
        <span className="muted">{size === "tiny" ? "No image" : "Choose an image for this tile"}</span>
        {size !== "tiny" && (
          <label className="btn btn--sm btn--ghost photo__pick">
            Pick image
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </label>
        )}
        {err && <span className="tilec__error">{err}</span>}
      </div>
    );
  }

  return (
    <figure className="photo">
      <img src={src} alt={caption ?? "Custom photo tile"} className="photo__img" />
      {caption && size !== "tiny" && <figcaption className="photo__caption">{caption}</figcaption>}
      <label className="photo__change chip" title="Change image">
        ↻
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
    </figure>
  );
}

/* --------------------------------- Weather --------------------------------- */
/* Deterministic local demo data, clearly labeled. A real provider can slot in
   behind exactly this shape later. */

const CONDITIONS = [
  { icon: "☀", label: "Clear" },
  { icon: "⛅", label: "Partly cloudy" },
  { icon: "☁", label: "Overcast" },
  { icon: "☂", label: "Light rain" },
  { icon: "≋", label: "Fog" },
  { icon: "❄", label: "Snow" },
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

interface DayForecast {
  name: string;
  icon: string;
  label: string;
  hi: number;
  lo: number;
}

function demoWeather(location: string, now: Date) {
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const base = hash(location.toLowerCase());
  const seasonal = 12 + 10 * Math.sin(((dayOfYear - 100) / 365) * 2 * Math.PI);
  const daily: DayForecast[] = [];
  for (let d = 0; d < 7; d++) {
    const seed = hash(`${base}-${dayOfYear + d}`);
    const cond = CONDITIONS[seed % CONDITIONS.length];
    const hi = Math.round(seasonal + (seed % 7) - 2);
    daily.push({
      name: d === 0 ? "Today" : new Date(now.getTime() + d * 86400000).toLocaleDateString([], { weekday: "short" }),
      icon: cond.icon,
      label: cond.label,
      hi,
      lo: hi - 4 - (seed % 4),
    });
  }
  const hour = now.getHours();
  const diurnal = -3 * Math.cos(((hour - 14) / 24) * 2 * Math.PI);
  const temp = Math.round(daily[0].lo + (daily[0].hi - daily[0].lo) * 0.6 + diurnal);
  const hourly = Array.from({ length: 6 }, (_, i) => {
    const h = (hour + 1 + i) % 24;
    const seed = hash(`${base}-${dayOfYear}-${h}`);
    return {
      hour: `${String(h).padStart(2, "0")}:00`,
      temp: Math.round(daily[0].lo + (daily[0].hi - daily[0].lo) * 0.6 - 3 * Math.cos(((h - 14) / 24) * 2 * Math.PI)),
      icon: CONDITIONS[seed % CONDITIONS.length].icon,
    };
  });
  const seed = hash(`${base}-${dayOfYear}`);
  return {
    temp,
    condition: daily[0],
    hourly,
    daily,
    humidity: 40 + (seed % 45),
    windKmh: 4 + (seed % 24),
  };
}

export function WeatherTile({ tile, size, live, slow }: TileProps) {
  const location = (tile.settings?.location as string | undefined)?.trim();
  const unit = (tile.settings?.unit as "C" | "F" | undefined) ?? "C";
  const now = useTileNow(cadence(60_000, slow), live);
  const [draft, setDraft] = useState("");

  const data = useMemo(() => (location ? demoWeather(location, now) : null), [location, now]);
  const t = (c: number) => (unit === "F" ? Math.round(c * 1.8 + 32) : c);

  if (!location || !data) {
    // Setup-required state: visible, useful, never broken (spec §12).
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="muted">{size === "tiny" ? "Set location" : "Choose a location to show weather"}</span>
        {size !== "tiny" && (
          <form
            className="tilec__inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) updateTileSettings(tile.id, { location: draft.trim() });
            }}
          >
            <input
              className="field"
              placeholder="e.g. Portland"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Weather location"
            />
            <button className="btn btn--sm" type="submit">Set</button>
          </form>
        )}
      </div>
    );
  }

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono">
          {data.condition.icon} {t(data.temp)}°
        </span>
      </div>
    );
  }

  return (
    <div className="tilec weather">
      <div className="weather__now">
        <span className={`mono ${size === "large" ? "tilec__huge" : "tilec__big"}`}>
          {data.condition.icon} {t(data.temp)}°{unit}
        </span>
        <div className="weather__meta">
          <span className="muted">{data.condition.label} · {location}</span>
          <span className="faint">
            H {t(data.condition.hi)}° · L {t(data.condition.lo)}°
          </span>
        </div>
      </div>

      {(size === "medium" || size === "large") && (
        <ul className="weather__hourly">
          {data.hourly.slice(0, size === "large" ? 6 : 4).map((h) => (
            <li key={h.hour} className="weather__hour">
              <span className="faint mono">{h.hour}</span>
              <span aria-hidden>{h.icon}</span>
              <span className="mono">{t(h.temp)}°</span>
            </li>
          ))}
        </ul>
      )}

      {size === "large" && (
        <>
          <ul className="weather__daily">
            {data.daily.map((d) => (
              <li key={d.name} className="weather__day">
                <span className="weather__day-name">{d.name}</span>
                <span aria-hidden>{d.icon}</span>
                <span className="muted weather__day-label">{d.label}</span>
                <span className="mono">{t(d.hi)}° / {t(d.lo)}°</span>
              </li>
            ))}
          </ul>
          <p className="faint tilec__hint">
            Humidity {data.humidity}% · Wind {data.windKmh} km/h ·{" "}
            <button
              className="tilec__link"
              onClick={() => updateTileSettings(tile.id, { unit: unit === "C" ? "F" : "C" })}
            >
              switch to °{unit === "C" ? "F" : "C"}
            </button>
          </p>
        </>
      )}
      <p className="faint tilec__hint">Demo data — no weather source connected.</p>
    </div>
  );
}
