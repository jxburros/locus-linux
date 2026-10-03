/*
 * Command registry.
 * ---------------------------------------------------------------------------
 * The command palette (Cmd/Ctrl-K) is data-driven from here. The OS is spatial
 * but must stay fast for keyboard users (spec §17): open apps, focus placed
 * tiles, add widgets, switch Workspaces, enter/exit Freeform, and run safe
 * system commands. The palette complements the desktop; it never replaces it.
 */

import { APPS } from "./appRegistry";
import { BUILTIN_TILE_KINDS, TILE_META } from "./tileMeta";
import { runIndex } from "./indexing";
import {
  getCurrentArrangement,
  getWorkspaces,
  getMode,
  getLowPower,
  isDashboardActive,
  switchLayout,
  focusTile,
  addTile,
  enterFreeform,
  exitFreeformDiscard,
  exitFreeformApply,
  setLowPower,
  clearScratchpad,
  tileName,
  tileIcon,
} from "./desktop";
import type { AppId } from "@/types";

export type CommandGroup = "Tiles" | "Apps" | "Workspaces" | "System";

export interface Command {
  id: string;
  label: string;
  /** Right-aligned secondary text (e.g. a shortcut or state). */
  hint?: string;
  group: CommandGroup;
  /** Single-glyph mark shown in the palette row. */
  icon?: string;
  /** Extra match terms so intent-typing finds the command. */
  keywords?: string[];
  run: () => void;
}

export interface CommandContext {
  openApp: (id: AppId) => void;
  goHome: () => void;
  toggleTheme: () => void;
  /** The resolved theme right now, so the toggle can label itself. */
  currentTheme: "light" | "dark";
}

/** Build the live command list for the current shell + desktop context. */
export function buildCommands(ctx: CommandContext): Command[] {
  const mode = getMode();

  const tileCommands: Command[] = getCurrentArrangement()
    .tiles.filter((t) => t.kind !== "gap")
    .map((t) => ({
      id: `focus:${t.id}`,
      label: `Focus ${tileName(t)}`,
      hint: "Tile",
      group: "Tiles" as const,
      icon: tileIcon(t),
      keywords: ["focus", "tile", tileName(t)],
      run: () => focusTile(t.id),
    }));

  const addCommands: Command[] = BUILTIN_TILE_KINDS.map((k) => ({
    id: `add:${k}`,
    label: `Add ${TILE_META[k].name} tile`,
    hint: TILE_META[k].tileClass,
    group: "Tiles" as const,
    icon: TILE_META[k].icon,
    keywords: ["add", "place", "widget", "anchor", ...TILE_META[k].keywords],
    run: () => addTile(k),
  }));

  const appCommands: Command[] = APPS.map((app) => ({
    id: `open:${app.id}`,
    label: `Open ${app.name}`,
    hint: app.category === "system" ? "System" : undefined,
    group: "Apps" as const,
    icon: app.icon,
    keywords: [app.name, app.description, ...(app.keywords ?? [])],
    run: () => ctx.openApp(app.id),
  }));

  const workspaceCommands: Command[] = [
    ...(!isDashboardActive()
      ? [
          {
            id: "workspace:dashboard",
            label: "Switch to Dashboard",
            hint: "Workspace",
            group: "Workspaces" as const,
            icon: "⌂",
            keywords: ["dashboard", "home", "default"],
            run: () => switchLayout("dashboard"),
          },
        ]
      : []),
    ...getWorkspaces().map((w) => ({
      id: `workspace:${w.id}`,
      label: `Switch to ${w.name} workspace`,
      hint: "Workspace",
      group: "Workspaces" as const,
      icon: "◫",
      keywords: ["workspace", "layout", "room", w.name],
      run: () => switchLayout(w.id),
    })),
  ];

  const systemCommands: Command[] = [
    ...(mode === "freeform"
      ? [
          {
            id: "system:freeform-discard",
            label: "Exit Freeform without saving",
            group: "System" as const,
            icon: "◇",
            keywords: ["freeform", "discard", "exit", "temporary"],
            run: exitFreeformDiscard,
          },
          {
            id: "system:freeform-apply",
            label: "Apply Freeform changes to current layout",
            group: "System" as const,
            icon: "◇",
            keywords: ["freeform", "apply", "save", "layout"],
            run: exitFreeformApply,
          },
        ]
      : [
          {
            id: "system:freeform",
            label: "Enter Freeform Mode",
            hint: "temporary",
            group: "System" as const,
            icon: "◇",
            keywords: ["freeform", "temporary", "experiment", "arrange", "layout"],
            run: enterFreeform,
          },
        ]),
    {
      id: "system:home",
      label: "Go to Dashboard",
      group: "System",
      icon: "⌂",
      keywords: ["home", "desktop", "dashboard", "back", "defocus"],
      run: ctx.goHome,
    },
    {
      id: "system:low-power",
      label: getLowPower() ? "Turn off low-power mode" : "Turn on low-power mode",
      hint: getLowPower() ? "on" : "off",
      group: "System",
      icon: "▮",
      keywords: ["power", "battery", "performance", "energy", "low"],
      run: () => setLowPower(!getLowPower()),
    },
    {
      id: "system:clear-scratchpad",
      label: "Clear Scratchpad (keep pinned)",
      group: "System",
      icon: "▤",
      keywords: ["scratchpad", "clear", "holding"],
      run: clearScratchpad,
    },
    {
      id: "system:index",
      label: "Index all sources now",
      group: "System",
      icon: "⟳",
      keywords: ["index", "reindex", "sources", "search"],
      run: () => runIndex(),
    },
    {
      id: "system:toggle-theme",
      label: ctx.currentTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      hint: ctx.currentTheme,
      group: "System",
      icon: ctx.currentTheme === "dark" ? "☀" : "☾",
      keywords: ["theme", "dark", "light", "appearance", "mode"],
      run: ctx.toggleTheme,
    },
  ];

  return [...tileCommands, ...appCommands, ...workspaceCommands, ...addCommands, ...systemCommands];
}

/** Score a command against a query. Returns -1 for no match. */
export function scoreCommand(cmd: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const haystack = [cmd.label, ...(cmd.keywords ?? [])].join(" ").toLowerCase();
  const idx = haystack.indexOf(q);
  if (idx === -1) return -1;
  // Prefer matches on the label, and earlier matches.
  const labelHit = cmd.label.toLowerCase().indexOf(q);
  return (labelHit === 0 ? 1000 : labelHit > 0 ? 500 : 0) - idx;
}
