/*
 * Effective AI permissions.
 * ---------------------------------------------------------------------------
 * Each app declares a default AI capability manifest. The user can override
 * where any individual capability sits on the tier ladder. This module merges
 * declarations with stored overrides to produce the effective permissions the
 * Control Center displays and a future AI runtime would consult before acting.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";
import type {
  AICapabilities,
  AppId,
  CapabilityTier,
} from "@/types";
import { CAPABILITY_TIERS, emptyCapabilities } from "@/types";

/** overrides[appId][capabilityLabel] = tier the user moved it to. */
type OverrideMap = Record<string, Record<string, CapabilityTier>>;

function loadOverrides(): OverrideMap {
  return storage.get<OverrideMap>(StoreKeys.permissionOverrides, {});
}

function saveOverrides(map: OverrideMap): void {
  storage.set(StoreKeys.permissionOverrides, map);
}

/** Flatten a manifest into label -> declared tier pairs. */
function flatten(caps: AICapabilities): Map<string, CapabilityTier> {
  const out = new Map<string, CapabilityTier>();
  (CAPABILITY_TIERS as CapabilityTier[]).forEach((tier) => {
    caps[tier].forEach((label) => out.set(label, tier));
  });
  return out;
}

export function effectiveCapabilities(
  appId: AppId,
  declared: AICapabilities,
): AICapabilities {
  const overrides = loadOverrides()[appId] ?? {};
  const flat = flatten(declared);
  for (const [label, tier] of Object.entries(overrides)) {
    // Ignore corrupt override tiers rather than crashing the merge.
    if (flat.has(label) && (CAPABILITY_TIERS as string[]).includes(tier)) {
      flat.set(label, tier);
    }
  }
  const result = emptyCapabilities();
  for (const [label, tier] of flat) result[tier].push(label);
  return result;
}

export function setCapabilityTier(
  appId: AppId,
  appName: string,
  capabilityLabel: string,
  tier: CapabilityTier,
): void {
  const map = loadOverrides();
  if (!map[appId]) map[appId] = {};
  map[appId][capabilityLabel] = tier;
  saveOverrides(map);
  record({
    type: "permission.changed",
    app: appId,
    summary: `${appName}: "${capabilityLabel}" set to ${tier}`,
  });
}

export function resetAppOverrides(appId: AppId, appName: string): void {
  const map = loadOverrides();
  if (map[appId]) {
    delete map[appId];
    saveOverrides(map);
    record({
      type: "permission.changed",
      app: appId,
      summary: `${appName}: permissions reset to defaults`,
    });
  }
}

export function hasOverrides(appId: AppId): boolean {
  return Boolean(loadOverrides()[appId]);
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.permissionOverrides, fn);
}
