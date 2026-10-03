import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CORES, type CoreId } from "./registry";
import { AI_CORE_ROUTES } from "./ai";
import { listActionDefinitions } from "../actionRegistry";
import { getApp } from "../appRegistry";

// Contract tests for the Core registry. The 2026-07-10 audit noted the registry
// is "an excellent inspectable architecture map" whose claims were unchecked
// prose. These assert the structural invariants a reader relies on so the map
// cannot silently drift from the code.

const HERE = dirname(fileURLToPath(import.meta.url));

const ALL_CORE_IDS: CoreId[] = [
  "time", "cardspoke", "editor", "files", "search", "people",
  "monitor", "web", "ai", "secrets", "security", "notification", "media", "dev",
];

/** Core id → co-located source/test basename (search lives in searchIndex.*). */
const MODULE_BASENAME: Record<CoreId, string> = {
  time: "time", cardspoke: "cardspoke", editor: "editor", files: "files",
  search: "searchIndex", people: "people", monitor: "monitor", web: "web",
  ai: "ai", secrets: "secrets", security: "security", notification: "notification",
  media: "media", dev: "dev",
};

const VALID_STATUSES = new Set(["functional", "minimal", "interface"]);

describe("Core registry contract", () => {
  it("declares exactly the 14 Cores in the CoreId union, uniquely", () => {
    const ids = CORES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(new Set(ids)).toEqual(new Set(ALL_CORE_IDS));
  });

  it("gives every Core a module and a co-located test suite", () => {
    for (const c of CORES) {
      const base = MODULE_BASENAME[c.id];
      expect(existsSync(join(HERE, `${base}.ts`)), `${c.id} module missing`).toBe(true);
      expect(existsSync(join(HERE, `${base}.test.ts`)), `${c.id} test suite missing`).toBe(true);
    }
  });

  it("gives every Core a valid status and at least one namespaced event", () => {
    for (const c of CORES) {
      expect(VALID_STATUSES.has(c.status), `${c.id} status ${c.status}`).toBe(true);
      expect(c.events.length, `${c.id} declares no events`).toBeGreaterThan(0);
      for (const e of c.events) {
        // Events are namespaced (contain a dot) so a wildcard subscriber works.
        expect(e.includes("."), `${c.id} event "${e}" is not namespaced`).toBe(true);
      }
    }
  });

  it("routes every AI intent to a Core that actually exists", () => {
    const ids = new Set(CORES.map((c) => c.id));
    for (const route of AI_CORE_ROUTES) {
      expect(ids.has(route.core), `AI route "${route.intent}" → unknown core ${route.core}`).toBe(true);
    }
  });
});

describe("Action Definition registry contract", () => {
  it("binds every action to a real owner Core and unique id", () => {
    const coreIds = new Set(CORES.map((c) => c.id));
    const actionIds = listActionDefinitions().map((d) => d.id);
    expect(new Set(actionIds).size).toBe(actionIds.length);
    for (const d of listActionDefinitions()) {
      expect(coreIds.has(d.ownerCore), `${d.id} owner ${d.ownerCore}`).toBe(true);
      if (d.effectKind === "external") {
        expect(d.external, `${d.id} is external but declares no executor owner`).toBeTruthy();
        expect(coreIds.has(d.external!.executorOwner)).toBe(true);
      } else {
        expect(d.external, `${d.id} is not external but declares an executor`).toBeUndefined();
      }
    }
  });

  it("declares governing labels for every proposing app, and each label exists in that app's manifest", () => {
    for (const d of listActionDefinitions()) {
      expect(d.apps.length, `${d.id} names no proposing apps`).toBeGreaterThan(0);
      for (const app of d.apps) {
        const labels = d.labels[app];
        expect(labels?.length, `${d.id} has no governing label for ${app}`).toBeTruthy();
        const manifest = getApp(app)?.permissions.ai;
        expect(manifest, `${d.id} names unknown app ${app}`).toBeTruthy();
        const declared = new Set([
          ...manifest!.readable,
          ...manifest!.suggestible,
          ...manifest!.writableWithApproval,
          ...manifest!.trusted,
          ...manifest!.forbidden,
        ]);
        for (const label of labels!) {
          expect(
            declared.has(label),
            `${d.id}: label "${label}" is not declared in ${app}'s manifest`,
          ).toBe(true);
        }
      }
    }
  });
});
