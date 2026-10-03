/*
 * Music tile — playback and now-playing.
 * ---------------------------------------------------------------------------
 * A demo library with a real transport model: play/pause, prev/next, a queue,
 * progress that advances while playing, and a mock output selector. Small
 * sizes are the "Anchor" reading of the same tile (now playing); larger sizes
 * expose the widget controls (spec §4's Music example).
 *
 * Phase 1 (Files, Media, And Real Local Bytes): a library entry backed by
 * real stored bytes gets a real hidden <audio> element fed by Media Core's
 * mediaUrlFor (a Blob URL over the byte store) — play/pause actually plays
 * audio for those entries. The demo library, and any library entry without
 * stored bytes yet, stay silent and say so.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TileProps } from "./registry";
import { cadence } from "./registry";
import { useStoredValue, useObjects } from "@/core/hooks";
import { StoreKeys } from "@/core/storage";
import { listMediaFiles, mediaUrlFor, releaseMediaUrl } from "@/core/cores/media";
import { hasStoredBytes } from "@/core/cores/files";
import { getObject } from "@/core/objects";

interface Track {
  title: string;
  artist: string;
  length: number; // seconds
  art: string; // glyph stand-in for album art
  /** True for real Media Core entries. */
  fromLibrary?: boolean;
  /** The underlying file object id, for library entries. */
  objectId?: string;
  /** True when the underlying file has real stored bytes (byteStore). */
  hasBytes?: boolean;
}

const DEMO_LIBRARY: Track[] = [
  { title: "Signal Path", artist: "Meridian Line", length: 254, art: "◧" },
  { title: "North Window", artist: "Low Field", length: 198, art: "◨" },
  { title: "Graphite", artist: "Meridian Line", length: 221, art: "◩" },
  { title: "Warm Static", artist: "Analog Room", length: 187, art: "◪" },
  { title: "Placed Things", artist: "Studio K", length: 243, art: "▨" },
];

const ARTS = ["◧", "◨", "◩", "◪", "▨"];

/** The user's actual audio files (Media Core over the shared file store);
    the hardcoded demo only appears when the library is empty. */
function useLibrary(): Track[] {
  const objects = useObjects();
  return useMemo(() => {
    const media = listMediaFiles().filter((m) => m.kind === "audio");
    if (media.length === 0) return DEMO_LIBRARY;
    return media.map((m, i) => {
      const obj = getObject(m.objectId);
      const bytesBacked = !!obj && hasStoredBytes(obj);
      return {
        title: m.title.replace(/\.[a-z0-9]+$/i, ""),
        artist: bytesBacked
          ? "Local file"
          : m.playable
            ? "Local file"
            : "Local file · format not playable here",
        length: 180,
        art: ARTS[i % ARTS.length],
        fromLibrary: true,
        objectId: m.objectId,
        hasBytes: bytesBacked,
      };
    });
  }, [objects]);
}

/** A Blob URL over the current track's stored bytes, live while it is the
    active track — released whenever the track changes or the tile unmounts.
    Silent (null) for the demo library and any entry without stored bytes. */
function useTrackAudioUrl(track: Track): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!track.fromLibrary || !track.hasBytes || !track.objectId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    mediaUrlFor(track.objectId).then((result) => {
      if (!cancelled) setUrl(result?.url ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [track.fromLibrary, track.hasBytes, track.objectId]);
  // Release the URL this effect created as soon as it is replaced/torn down.
  useEffect(() => {
    if (!url) return;
    return () => releaseMediaUrl(url);
  }, [url]);
  return url;
}

const OUTPUTS = ["This device", "Studio monitors", "Kitchen speaker"];

interface MusicState {
  index: number;
  playing: boolean;
  progress: number;
  output: number;
  volume: number;
}

const INITIAL: MusicState = { index: 0, playing: false, progress: 0, output: 0, volume: 70 };

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function MusicTile({ size, live, slow }: TileProps) {
  const [state, setState] = useStoredValue<MusicState>(StoreKeys.musicState, INITIAL);
  const LIBRARY = useLibrary();
  const track = LIBRARY[state.index % LIBRARY.length];
  const audioUrl = useTrackAudioUrl(track);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Advance progress while playing and the tile is allowed to be live.
  useEffect(() => {
    if (!state.playing || !live) return;
    const step = slow ? 5 : 1;
    const id = window.setInterval(() => {
      setState(
        state.progress + step >= track.length
          ? { ...state, index: (state.index + 1) % LIBRARY.length, progress: 0 }
          : { ...state, progress: state.progress + step },
      );
    }, cadence(1000, false) * step);
    return () => window.clearInterval(id);
  });

  // Real playback for byte-backed tracks: mirror transport state onto the
  // hidden <audio> element. The demo/no-bytes case has no audioUrl, so this
  // is a no-op there — progress still advances on the synthetic ticker above.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (state.playing && audioUrl) void el.play().catch(() => {});
    else el.pause();
  }, [state.playing, audioUrl]);

  const toggle = () => setState({ ...state, playing: !state.playing });
  const next = () => setState({ ...state, index: (state.index + 1) % LIBRARY.length, progress: 0 });
  const prev = () =>
    setState(
      state.progress > 4
        ? { ...state, progress: 0 }
        : { ...state, index: (state.index + LIBRARY.length - 1) % LIBRARY.length, progress: 0 },
    );

  // Hidden, real audio output for byte-backed tracks — present at every
  // size so playback survives a resize.
  const audioEl = audioUrl && (
    <audio ref={audioRef} src={audioUrl} className="sr-only" onEnded={next} />
  );

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        {audioEl}
        <span className="tilec__big mono" aria-hidden>{state.playing ? track.art : "♪"}</span>
        {state.playing && <span className="faint music__marquee">{track.title}</span>}
      </div>
    );
  }

  const pct = Math.min(100, (state.progress / track.length) * 100);

  return (
    <div className="tilec music">
      {audioEl}
      <div className="music__now">
        <span className="music__art mono" aria-hidden>{track.art}</span>
        <div className="music__titles">
          <span className="music__title">{track.title}</span>
          <span className="faint">{track.artist}</span>
        </div>
        <button className="music__btn music__btn--main" onClick={toggle} aria-label={state.playing ? "Pause" : "Play"}>
          {state.playing ? "❚❚" : "►"}
        </button>
      </div>

      {size !== "small" && (
        <>
          <div className="music__progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="music__progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="music__transport">
            <span className="faint mono">{fmt(state.progress)}</span>
            <span className="music__buttons">
              <button className="music__btn" onClick={prev} aria-label="Previous track">⏮</button>
              <button className="music__btn" onClick={toggle} aria-label={state.playing ? "Pause" : "Play"}>
                {state.playing ? "❚❚" : "►"}
              </button>
              <button className="music__btn" onClick={next} aria-label="Next track">⏭</button>
            </span>
            <span className="faint mono">{fmt(track.length)}</span>
          </div>
        </>
      )}

      {size === "medium" && (
        <p className="faint tilec__hint">
          Next: {LIBRARY[(state.index + 1) % LIBRARY.length].title} — {LIBRARY[(state.index + 1) % LIBRARY.length].artist}
        </p>
      )}

      {size === "large" && (
        <>
          <p className="eyebrow">Queue</p>
          <ul className="music__queue">
            {LIBRARY.map((t, i) => (
              <li key={t.title}>
                <button
                  className={`music__queue-row ${i === state.index ? "is-active" : ""}`}
                  onClick={() => setState({ ...state, index: i, progress: 0, playing: true })}
                >
                  <span className="mono" aria-hidden>{t.art}</span>
                  <span className="music__queue-title">{t.title}</span>
                  <span className="faint">{t.artist}</span>
                  <span className="faint mono">{fmt(t.length)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="music__device">
            <label className="faint" htmlFor={`music-out`}>Output</label>
            <select
              id="music-out"
              className="field music__select"
              value={state.output}
              onChange={(e) => setState({ ...state, output: Number(e.target.value) })}
            >
              {OUTPUTS.map((o, i) => (
                <option key={o} value={i}>{o}</option>
              ))}
            </select>
            <label className="faint" htmlFor="music-vol">Vol</label>
            <input
              id="music-vol"
              type="range"
              min={0}
              max={100}
              value={state.volume}
              onChange={(e) => setState({ ...state, volume: Number(e.target.value) })}
            />
          </div>
          <p className="faint tilec__hint">
            {track.fromLibrary
              ? track.hasBytes
                ? "Your media files (Media Core) — real playback from stored bytes."
                : "Your media files (Media Core) — imported without bytes yet; re-import in Files to hear it."
              : "Demo library — add audio files in Files to see your own here."}
          </p>
        </>
      )}
    </div>
  );
}
