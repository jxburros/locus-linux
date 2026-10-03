/*
 * Shell navigation context (definition only — provider lives in
 * components/Shell.tsx). Kept JSX-free so both shell components and apps can
 * import the hook without a circular dependency on the provider.
 */

import { createContext, useContext } from "react";
import type { AppId } from "@/types";

export interface ShellState {
  /** The open app, or null when the home screen is showing. */
  activeApp: AppId | null;
  /** Open an app by id (records the launch + updates recents). */
  openApp: (id: AppId) => void;
  /** Return to the home screen. */
  goHome: () => void;
  /** Most-recently-opened app ids, newest first. */
  recentApps: AppId[];

  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within <Shell>");
  return ctx;
}
