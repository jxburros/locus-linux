/*
 * TileSettingsDialog — "Customize…" for one tile (spec §14).
 * ---------------------------------------------------------------------------
 * Name, accent, AI visibility, performance priority, and the kind-specific
 * data-source settings (weather location/units, photo caption, assistant
 * name). Header segments (issue #6) get their own editor here: add, remove,
 * and reorder header items, and add segments on other edges (issue #10).
 * Deliberately small: most customization happens by direct dragging and
 * resizing, never through a settings panel.
 */

import { useState, useSyncExternalStore } from "react";
import type { EdgeSide, HeaderItemKind, TileInstance } from "@/types";
import { REQUIRED_HEADER_KINDS } from "@/types";
import {
  updateTile,
  updateTileSettings,
  tileName,
  getDesktop,
  getWidgets,
  subscribe as subscribeDesktop,
  headerItems,
  addHeaderItem,
  removeHeaderItem,
  moveHeaderItem,
  canRemoveHeaderItem,
  addHeaderSegment,
} from "@/core/desktop";
import { storage, StoreKeys } from "@/core/storage";
import { DEFAULT_ASSISTANT_NAME } from "../tiles/AssistantTile";
import { effectiveLifecycle } from "../tiles/registry";

const HEADER_KIND_LABELS: Record<HeaderItemKind, string> = {
  logo: "Logo — always returns to the Dashboard",
  mode: "Dashboard ↔ Focus switcher",
  freeform: "Freeform (hosts the Freeform controls)",
  apps: "Apps",
  settings: "Settings",
  spacer: "Spacer",
  workspace: "Mode & workspace name",
  shuffle: "Shuffle — repack with no gaps",
  search: "Command palette",
  ai: "AI status",
  notifications: "Notifications",
  battery: "Battery",
  clock: "Clock",
  scratchpad: "Scratchpad",
};

const EDGES: EdgeSide[] = ["top", "bottom", "left", "right"];

/** The header's own widget editor — the required items stay locked in place. */
function HeaderItemsEditor({ segmentId }: { segmentId: string }) {
  useSyncExternalStore(subscribeDesktop, getDesktop);
  const segment = getWidgets().find((w) => w.id === segmentId);
  const [adding, setAdding] = useState<HeaderItemKind>("clock");
  if (!segment) return null;
  const items = headerItems(segment);

  return (
    <div className="tdialog__header-editor">
      <span className="faint">Header items — the header is as customizable as the rest of the OS</span>
      <ul className="tdialog__hlist">
        {items.map((item, i) => {
          const locked = !canRemoveHeaderItem(item);
          return (
            <li key={item.id} className="tdialog__hitem">
              <span className="tdialog__hname">
                {HEADER_KIND_LABELS[item.kind]}
                {REQUIRED_HEADER_KINDS.includes(item.kind) && (
                  <span className="mono faint"> · required</span>
                )}
              </span>
              <span className="tdialog__hctl">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={i === 0}
                  onClick={() => moveHeaderItem(segmentId, item.id, -1)}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={i === items.length - 1}
                  onClick={() => moveHeaderItem(segmentId, item.id, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={locked}
                  title={locked ? "The last copy of a required control cannot be removed" : "Remove"}
                  onClick={() => removeHeaderItem(segmentId, item.id)}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="tdialog__row">
        <select
          className="field"
          value={adding}
          onChange={(e) => setAdding(e.target.value as HeaderItemKind)}
          aria-label="Header item to add"
        >
          {(Object.keys(HEADER_KIND_LABELS) as HeaderItemKind[]).map((k) => (
            <option key={k} value={k}>{HEADER_KIND_LABELS[k]}</option>
          ))}
        </select>
        <button type="button" className="btn btn--sm" onClick={() => addHeaderItem(segmentId, adding)}>
          Add item
        </button>
      </div>
      <div className="tdialog__row tdialog__row--wrap">
        <span className="faint">Add another header segment (the header can occupy several edges):</span>
        {EDGES.map((edge) => (
          <button key={edge} type="button" className="btn btn--ghost btn--sm" onClick={() => addHeaderSegment(edge)}>
            {edge}
          </button>
        ))}
      </div>
    </div>
  );
}

interface TileSettingsDialogProps {
  tile: TileInstance;
  onClose: () => void;
}

export function TileSettingsDialog({ tile, onClose }: TileSettingsDialogProps) {
  const [title, setTitle] = useState(tile.title ?? "");
  const [accent, setAccent] = useState(Boolean(tile.accent));
  const [aiVisible, setAiVisible] = useState(tile.aiVisible !== false);
  const [lifecycle, setLifecycle] = useState(effectiveLifecycle(tile));
  const [location, setLocation] = useState((tile.settings?.location as string) ?? "");
  const [unit, setUnit] = useState(((tile.settings?.unit as string) ?? "C") as "C" | "F");
  const [caption, setCaption] = useState((tile.settings?.caption as string) ?? "");
  const [assistantName, setAssistantName] = useState(
    storage.get<string>(StoreKeys.assistantName, DEFAULT_ASSISTANT_NAME),
  );

  function save(e: React.FormEvent) {
    e.preventDefault();
    updateTile(tile.id, {
      title: title.trim() || undefined,
      accent,
      aiVisible,
      lifecycle,
    });
    if (tile.kind === "weather") updateTileSettings(tile.id, { location: location.trim(), unit });
    if (tile.kind === "photo") updateTileSettings(tile.id, { caption: caption.trim() });
    if (tile.kind === "assistant") {
      storage.set(StoreKeys.assistantName, assistantName.trim() || DEFAULT_ASSISTANT_NAME);
    }
    onClose();
  }

  return (
    <div className="tdialog" role="dialog" aria-modal="true" aria-label={`Customize ${tileName(tile)}`}>
      <div className="tdialog__scrim" onClick={onClose} />
      <form className="tdialog__panel" onSubmit={save}>
        <h2 className="tdialog__title">Customize {tileName(tile)}</h2>

        <label className="tdialog__field">
          <span className="faint">Tile name</span>
          <input
            className="field"
            value={title}
            placeholder={tileName({ ...tile, title: undefined })}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {tile.kind === "assistant" && (
          <label className="tdialog__field">
            <span className="faint">Assistant name (yours to choose — the provider is separate)</span>
            <input className="field" value={assistantName} onChange={(e) => setAssistantName(e.target.value)} />
          </label>
        )}

        {tile.kind === "weather" && (
          <div className="tdialog__row">
            <label className="tdialog__field tdialog__field--grow">
              <span className="faint">Location</span>
              <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="tdialog__field">
              <span className="faint">Units</span>
              <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as "C" | "F")}>
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
            </label>
          </div>
        )}

        {tile.kind === "photo" && (
          <label className="tdialog__field">
            <span className="faint">Caption</span>
            <input className="field" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
        )}

        {tile.kind === "home" && <HeaderItemsEditor segmentId={tile.id} />}

        <div className="tdialog__row">
          <label className="tdialog__check">
            <input type="checkbox" checked={accent} onChange={(e) => setAccent(e.target.checked)} />
            Accent highlight
          </label>
          <label className="tdialog__check">
            <input type="checkbox" checked={aiVisible} onChange={(e) => setAiVisible(e.target.checked)} />
            Visible to AI
          </label>
        </div>

        <label className="tdialog__field">
          <span className="faint">Performance priority</span>
          <select
            className="field"
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value as "live" | "warm" | "sleeping")}
          >
            <option value="live">Live — updates continuously</option>
            <option value="warm">Warm — updates slowly, ready quickly</option>
            <option value="sleeping">Sleeping — inactive until selected</option>
          </select>
        </label>

        <div className="tdialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary">Save</button>
        </div>
      </form>
    </div>
  );
}
