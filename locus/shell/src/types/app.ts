import type { ComponentType } from "react";
import type { PermissionManifest } from "./permissions";

/** Stable identifiers for every system app. Add new ids here first. */
export type AppId =
  | "writer"
  | "cards"
  | "tasks"
  | "projects"
  | "files"
  | "time"
  | "monitor"
  | "vault"
  | "people"
  | "web"
  | "search"
  | "assistant"
  | "ai-control"
  | "sources"
  | "settings"
  | "audit-log"
  | "platform"
  | "cores"
  | "dev";

export type AppCategory = "workspace" | "system";

/**
 * How finished an app is. Drives a small badge in the launcher so the shell
 * never over-promises. In v1 most apps are "stub".
 */
export type AppStatus = "stable" | "beta" | "stub";

/**
 * Anchor eligibility + defaults. An anchor-eligible app can be placed as a
 * persistent tile on the spatial desktop; its `preview` renders the compact
 * live view shown in that tile (falls back to a generic summary if omitted).
 */
export interface AnchorSpec {
  eligible: boolean;
  /** Default tile span when the app is added to a workspace. */
  defaultSpan?: { col: number; row: number };
  /** Compact live view for the AnchorTile. Receives no props. */
  preview?: ComponentType;
}

/**
 * The single source of truth for an app. The registry is just an array of
 * these. Everything the shell needs to render, launch, search, place as an
 * Anchor, and describe an app to the AI lives here.
 */
export interface AppModule {
  id: AppId;
  name: string;
  /** One short line shown in the launcher and command palette. */
  description: string;
  /** Short placeholder mark drawn in a monospace tile. */
  icon: string;
  category: AppCategory;
  status: AppStatus;
  /** The view rendered inside the AppFrame / FocusSurface when this app is open. */
  component: ComponentType;
  /** Local, device, network, and AI-facing permission declarations. */
  permissions: PermissionManifest;
  /** Extra search terms so the palette can find the app by intent. */
  keywords?: string[];
  /** Whether/how this app can live on the spatial desktop as an Anchor. */
  anchor?: AnchorSpec;
}
