/*
 * Appearance: theme, accent, density, and system name.
 * ---------------------------------------------------------------------------
 * State is a plain object persisted through core/storage. Applying it means
 * flipping data-* attributes on <html> and copying one accent pair into the
 * live --accent / --accent-ink variables. Components read appearance through
 * the useAppearance() hook (core/hooks.ts).
 */

import { storage, StoreKeys } from "./storage";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "compact" | "comfortable" | "spacious";
export type AccentName = "slate" | "amber" | "green" | "violet" | "crimson";

export interface Appearance {
  theme: ThemeMode;
  accent: AccentName;
  density: Density;
  systemName: string;
}

export const ACCENTS: { name: AccentName; label: string; swatch: string }[] = [
  { name: "slate", label: "Slate", swatch: "#3f6fb0" },
  { name: "amber", label: "Amber", swatch: "#b07d2f" },
  { name: "green", label: "Green", swatch: "#3f8f6b" },
  { name: "violet", label: "Violet", swatch: "#7159b8" },
  { name: "crimson", label: "Crimson", swatch: "#b0463f" },
];

export const DEFAULT_SYSTEM_NAME = "Locus";

export function loadAppearance(): Appearance {
  return {
    theme: storage.get<ThemeMode>(StoreKeys.theme, "dark"),
    accent: storage.get<AccentName>(StoreKeys.accent, "slate"),
    density: storage.get<Density>(StoreKeys.density, "comfortable"),
    systemName: storage.get<string>(StoreKeys.systemName, DEFAULT_SYSTEM_NAME),
  };
}

/** Resolve "system" against the OS preference. */
function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
}

/** Push appearance to the DOM. Safe to call on every change. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(a.theme));
  root.setAttribute("data-density", a.density);

  const styles = getComputedStyle(root);
  const accentValue = styles.getPropertyValue(`--accent-${a.accent}`).trim();
  const accentInk = styles.getPropertyValue(`--accent-${a.accent}-ink`).trim();
  if (accentValue) root.style.setProperty("--accent", accentValue);
  if (accentInk) root.style.setProperty("--accent-ink", accentInk);

  // Keep the browser UI (address bar, task switcher) in sync.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      resolveTheme(a.theme) === "dark" ? "#0c0d0f" : "#f7f8f9",
    );
  }
}

export function saveAppearance(a: Appearance): void {
  storage.set(StoreKeys.theme, a.theme);
  storage.set(StoreKeys.accent, a.accent);
  storage.set(StoreKeys.density, a.density);
  storage.set(StoreKeys.systemName, a.systemName);
}

/** Watch the OS theme so "system" mode updates live. Returns an unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * User-level reduced motion (independent of the OS media query, which is also
 * honored in CSS). Stored separately from Appearance so tiles and the desktop
 * can flip it without going through the provider.
 */
export function applyReducedMotion(): void {
  const on = storage.get<boolean>(StoreKeys.reducedMotion, false);
  document.documentElement.toggleAttribute("data-reduced-motion", on);
}

export function watchReducedMotion(): () => void {
  return storage.subscribe(StoreKeys.reducedMotion, applyReducedMotion);
}
