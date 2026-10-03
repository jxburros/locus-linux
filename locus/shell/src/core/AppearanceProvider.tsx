/*
 * Holds live appearance state, applies it to the DOM, and persists it. Wraps
 * the app so any component can read or change appearance via useAppearance().
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  watchSystemTheme,
  type Appearance,
} from "./theme";
import { record } from "./audit";

interface AppearanceContextValue {
  appearance: Appearance;
  /** Patch one or more fields; applies + persists immediately. */
  update: (patch: Partial<Appearance>) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance());

  // Apply on mount and whenever appearance changes.
  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  // Keep "system" theme live with the OS.
  useEffect(() => {
    if (appearance.theme !== "system") return;
    return watchSystemTheme(() => applyAppearance(appearance));
  }, [appearance]);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      saveAppearance(next);
      const changed = Object.keys(patch)[0];
      record({
        type: "setting.changed",
        app: "settings",
        summary: `Appearance: ${changed} → ${String((patch as Record<string, unknown>)[changed])}`,
      });
      return next;
    });
  }, []);

  const value = useMemo(() => ({ appearance, update }), [appearance, update]);
  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within <AppearanceProvider>");
  return ctx;
}
