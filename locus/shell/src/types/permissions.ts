/*
 * The permission model.
 *
 * Locus separates reading/indexing from action. Once a source is connected,
 * the AI layer should be able to inspect normal local context broadly. Writes,
 * external sharing, credential use, destructive changes, and irreversible work
 * remain gated by approval, trusted-action status, or hard forbiddance.
 */

/** The five AI capability tiers, from least to most powerful. */
export type CapabilityTier =
  | "readable"
  | "suggestible"
  | "writableWithApproval"
  | "trusted"
  | "forbidden";

export const CAPABILITY_TIERS: CapabilityTier[] = [
  "readable",
  "suggestible",
  "writableWithApproval",
  "trusted",
  "forbidden",
];

export interface CapabilityTierMeta {
  tier: CapabilityTier;
  label: string;
  /** One line, written from the user's side of the screen. */
  description: string;
  /** Rank used to render the escalation ladder. Forbidden sits apart. */
  rank: number;
}

export const CAPABILITY_META: Record<CapabilityTier, CapabilityTierMeta> = {
  readable: {
    tier: "readable",
    label: "Readable",
    description: "The AI can inspect this connected context.",
    rank: 0,
  },
  suggestible: {
    tier: "suggestible",
    label: "Suggestible",
    description: "The AI can propose changes. Nothing happens until you act.",
    rank: 1,
  },
  writableWithApproval: {
    tier: "writableWithApproval",
    label: "Writable with approval",
    description: "The AI can make the change once you approve it.",
    rank: 2,
  },
  trusted: {
    tier: "trusted",
    label: "Trusted",
    description: "The AI can do this automatically, without asking.",
    rank: 3,
  },
  forbidden: {
    tier: "forbidden",
    label: "Forbidden",
    description: "The AI can never do this.",
    rank: 4,
  },
};

export interface AICapabilities {
  readable: string[];
  suggestible: string[];
  writableWithApproval: string[];
  trusted: string[];
  forbidden: string[];
}

export interface PermissionManifest {
  /** User-owned object scopes this app can store, read, or index locally. */
  localData: string[];
  /** Browser/device surfaces this app can touch, usually after user action. */
  device: string[];
  /** Network or external provider surfaces. Empty means local-only in v1. */
  network: string[];
  /** AI-facing capability tiers for context, suggestions, actions, and bans. */
  ai: AICapabilities;
}

export function emptyCapabilities(): AICapabilities {
  return {
    readable: [],
    suggestible: [],
    writableWithApproval: [],
    trusted: [],
    forbidden: [],
  };
}
