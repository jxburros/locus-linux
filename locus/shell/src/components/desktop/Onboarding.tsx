/*
 * First-run onboarding (spec §23).
 * ---------------------------------------------------------------------------
 * Locus never opens onto a blank editor: the default Dashboard is already
 * placed. This overlay teaches only the core interactions, once, and offers
 * naming the assistant. AI setup can wait.
 */

import { useState } from "react";
import { storage, StoreKeys } from "@/core/storage";
import { deliver } from "@/core/cores/notification";
import { DEFAULT_ASSISTANT_NAME } from "../tiles/AssistantTile";

const LESSONS: { mark: string; text: string }[] = [
  { mark: "✥", text: "Drag a tile by its header to move it — placement is nearly freeform, and guides snap it to edges, centers, and equal spacing." },
  { mark: "⇲", text: "Grab a tile's edge or corner to resize it. Touching tiles share one border; space between tiles exists only where you make it." },
  { mark: "⤢", text: "Double-click a tile (or its ⤢) to Focus it — it grows in place and the rest of your layout compresses around it. You never leave the workspace." },
  { mark: "⌂", text: "The Locus mark lives in the Home widget — a pinned edge tile. It always returns you to the Dashboard, wherever it is." },
  { mark: "◇", text: "Freeform lets you rearrange temporarily. Nothing is saved until you say so." },
  { mark: "◫", text: "Save a Freeform arrangement as a Workspace — a named room you can return to." },
  { mark: "▤", text: "Drop tiles on the Scratchpad to keep them on deck without placing them." },
  { mark: "◐", text: "The assistant works locally today; connect Ollama, a server, or an API later — or never." },
];

interface OnboardingProps {
  onDone: () => void;
}

export default function Onboarding({ onDone }: OnboardingProps) {
  const [assistant, setAssistant] = useState(DEFAULT_ASSISTANT_NAME);

  function start() {
    storage.set(StoreKeys.assistantName, assistant.trim() || DEFAULT_ASSISTANT_NAME);
    storage.set(StoreKeys.desktopOnboarded, true);
    deliver({
      title: "Welcome to Locus",
      detail: "Your Dashboard is saved automatically. Right-click any tile to customize it.",
      source: "System",
    });
    onDone();
  }

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="Welcome to Locus">
      <div className="onboard__scrim" />
      <div className="onboard__panel">
        <p className="eyebrow">Locus OS</p>
        <h1 className="onboard__title">A spatial operating surface.</h1>
        <p className="muted onboard__sub">
          No floating windows, no icon pile, no fixed chrome. One surface of placed tiles that
          fits your screen and never scrolls — you arrange, focus, shrink, replace, and save.
        </p>
        <ul className="onboard__lessons">
          {LESSONS.map((l) => (
            <li key={l.mark} className="onboard__lesson">
              <span className="mono onboard__mark" aria-hidden>{l.mark}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
        <label className="onboard__name">
          <span className="faint">Name your assistant (you can change this any time)</span>
          <input className="field" value={assistant} onChange={(e) => setAssistant(e.target.value)} />
        </label>
        <button className="btn btn--primary onboard__start" onClick={start}>
          Start using Locus
        </button>
      </div>
    </div>
  );
}
