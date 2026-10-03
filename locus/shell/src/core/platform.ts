/*
 * Platform expansion — the routing abstraction.
 * ---------------------------------------------------------------------------
 * The PWA shell is milestone one. Later milestones wrap it for desktop and
 * Android and route AI work to on-device or server models (AI Server Studio).
 * None of that changes the product model, so the seam belongs in one small
 * place: a model-routing table that says which class of request goes where.
 *
 * This is deliberately inert in this build — no request is actually sent — but
 * the routing decision, the targets, and the platform capabilities are modelled
 * so the later work is a matter of implementing an adapter, not redesigning.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";

export type RouteTarget = "none" | "on-device" | "local-server" | "cloud";

/** A class of AI request the router can dispatch differently. */
export type RouteClass = "quick" | "reasoning" | "embedding" | "sensitive";

export interface PlatformTarget {
  id: string;
  name: string;
  kind: "web" | "desktop" | "android" | "server";
  status: "active" | "planned";
  detail: string;
  /** Integration surface a later phase would implement. */
  integration: string[];
}

/** The platforms Locus targets. Only "web" is active in this milestone. */
export const PLATFORM_TARGETS: PlatformTarget[] = [
  {
    id: "web",
    name: "Web / PWA",
    kind: "web",
    status: "active",
    detail: "The installable browser shell you are running now.",
    integration: ["Service worker", "Web app manifest", "localStorage / IndexedDB"],
  },
  {
    id: "desktop",
    name: "Desktop wrapper",
    kind: "desktop",
    status: "planned",
    detail: "A Tauri/Electron shell adding native windows, tray, and file access.",
    integration: ["Native menus", "Filesystem bridge", "Auto-update", "OS notifications"],
  },
  {
    id: "android",
    name: "Android launcher",
    kind: "android",
    status: "planned",
    detail: "A home-screen / launcher mode via TWA, growing toward a ROM direction.",
    integration: ["Trusted Web Activity", "Launcher intents", "Share targets", "Widgets"],
  },
  {
    id: "server",
    name: "AI Server Studio",
    kind: "server",
    status: "planned",
    detail: "Routing to a local model server for private, high-capability inference.",
    integration: ["Model registry", "Local endpoint discovery", "Streaming transport"],
  },
];

// Registered in StoreKeys — every persisted key stays self-describing.
const ROUTING_KEY = StoreKeys.platformRouting;

export type RoutingTable = Record<RouteClass, RouteTarget>;

const DEFAULT_ROUTING: RoutingTable = {
  quick: "on-device",
  reasoning: "cloud",
  embedding: "on-device",
  sensitive: "on-device",
};

export const ROUTE_CLASS_META: Record<RouteClass, string> = {
  quick: "Fast, small requests (labels, quick rewrites).",
  reasoning: "Heavy reasoning and long-form generation.",
  embedding: "Local search and indexing embeddings.",
  sensitive: "Anything touching private or credentialed data.",
};

// Stable-reference cache for useSyncExternalStore (see core/workspace.ts).
let cache: RoutingTable | null = null;

export function getRouting(): RoutingTable {
  if (cache) return cache;
  cache = storage.get<RoutingTable>(ROUTING_KEY, DEFAULT_ROUTING);
  return cache;
}

export function setRoute(cls: RouteClass, target: RouteTarget): void {
  const next = { ...getRouting(), [cls]: target };
  cache = next;
  storage.set(ROUTING_KEY, next);
  record({
    type: "setting.changed",
    summary: `Model routing: ${cls} → ${target}`,
    detail: "Routing preference saved. No requests are dispatched in this build.",
  });
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(ROUTING_KEY, () => {
    cache = null;
    fn();
  });
}
