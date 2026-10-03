/*
 * Generic tile for a registry app placed on the desktop.
 * ---------------------------------------------------------------------------
 * Small/medium sizes show the app's compact live preview (real state, not
 * dashboard filler); Focus opens the full app. Apps without a preview get an
 * honest description card.
 */

import type { TileProps } from "./registry";
import { getApp } from "@/core/appRegistry";
import { useShell } from "@/core/shell";
import type { AppId } from "@/types";

export function AppTileContent({ tile, size }: TileProps) {
  const { openApp } = useShell();
  const app = tile.app ? getApp(tile.app as AppId) : undefined;

  if (!app) {
    // Error state: clear, non-alarming (spec §22).
    return (
      <div className="tilec tilec--center tilec--setup">
        <span className="muted">This tile's app is unavailable.</span>
        <span className="faint tilec__hint">Remove the tile or return it from Apps.</span>
      </div>
    );
  }

  if (size === "tiny") {
    return (
      <div className="tilec tilec--center">
        <span className="tilec__big mono" aria-hidden>{app.icon}</span>
        <span className="faint">{app.name}</span>
      </div>
    );
  }

  const Preview = app.anchor?.preview;
  return (
    <div className="tilec apptile">
      {Preview ? (
        <Preview />
      ) : (
        <p className="muted apptile__desc">{app.description}</p>
      )}
      {(size === "medium" || size === "large") && (
        <button className="tilec__link" onClick={() => openApp(app.id)}>
          Open {app.name} in Focus →
        </button>
      )}
    </div>
  );
}
