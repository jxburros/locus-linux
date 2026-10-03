import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AiModule from "./ai";
import type * as RegistryModule from "./registry";

let Ai: typeof AiModule;
let Registry: typeof RegistryModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Ai = await import("./ai");
  Registry = await import("./registry");
});

describe("AI_CORE_ROUTES — architecture honesty", () => {
  it("routes every intent to a Core that actually exists in the registry", () => {
    const knownIds = new Set(Registry.CORES.map((c) => c.id));
    for (const route of Ai.AI_CORE_ROUTES) {
      expect(knownIds.has(route.core)).toBe(true);
    }
  });
});

describe("isValidPattern", () => {
  it("accepts simple comma-separated keywords", () => {
    expect(Ai.isValidPattern("summarize, translate")).toBe(true);
  });

  it("rejects an empty pattern", () => {
    expect(Ai.isValidPattern("")).toBe(false);
  });

  it("rejects a pattern over 200 characters", () => {
    expect(Ai.isValidPattern("a".repeat(201))).toBe(false);
  });

  it("rejects more than 20 keywords", () => {
    const pattern = Array.from({ length: 21 }, (_, i) => `kw${i}`).join(",");
    expect(Ai.isValidPattern(pattern)).toBe(false);
  });

  it("rejects a keyword containing regex-special characters", () => {
    expect(Ai.isValidPattern("safe, .*evil(regex)")).toBe(false);
  });

  it("rejects a blank keyword between commas", () => {
    expect(Ai.isValidPattern("summarize, , translate")).toBe(false);
  });
});

describe("routing rule CRUD", () => {
  it("addRoutingRule rejects an invalid pattern and adds nothing", () => {
    expect(Ai.addRoutingRule({ pattern: "bad(regex)", route: "local" })).toBeNull();
    expect(Ai.listRoutingRules()).toHaveLength(0);
  });

  it("addRoutingRule persists a valid rule, enabled by default", () => {
    const rule = Ai.addRoutingRule({ pattern: "summarize, tldr", route: "cloud", modelHint: "gpt" });
    expect(rule).not.toBeNull();
    expect(rule!.enabled).toBe(true);
    expect(Ai.listRoutingRules().map((r) => r.id)).toEqual([rule!.id]);
  });

  it("setRoutingRuleEnabled toggles a rule without touching others", () => {
    const rule = Ai.addRoutingRule({ pattern: "summarize", route: "cloud" })!;
    Ai.setRoutingRuleEnabled(rule.id, false);
    expect(Ai.listRoutingRules()[0].enabled).toBe(false);
  });

  it("removeRoutingRule deletes it", () => {
    const rule = Ai.addRoutingRule({ pattern: "summarize", route: "cloud" })!;
    Ai.removeRoutingRule(rule.id);
    expect(Ai.listRoutingRules()).toHaveLength(0);
  });
});

describe("suggestRoute", () => {
  it("defaults to local when no rule matches", () => {
    const suggestion = Ai.suggestRoute("do something unrelated");
    expect(suggestion.route).toBe("local");
  });

  it("matches a keyword case-insensitively and reports why", () => {
    Ai.addRoutingRule({ pattern: "translate, summarize", route: "cloud", modelHint: "gpt-x" });
    const suggestion = Ai.suggestRoute("Please TRANSLATE this document");
    expect(suggestion.route).toBe("cloud");
    expect(suggestion.modelHint).toBe("gpt-x");
    expect(suggestion.reason).toContain("translate");
  });

  it("skips a disabled rule", () => {
    const rule = Ai.addRoutingRule({ pattern: "translate", route: "cloud" })!;
    Ai.setRoutingRuleEnabled(rule.id, false);
    expect(Ai.suggestRoute("translate this").route).toBe("local");
  });

  it("prefers the most recently added matching rule", () => {
    Ai.addRoutingRule({ pattern: "summarize", route: "local" });
    Ai.addRoutingRule({ pattern: "summarize", route: "cloud", modelHint: "newer" });
    const suggestion = Ai.suggestRoute("please summarize this");
    expect(suggestion.route).toBe("cloud");
    expect(suggestion.modelHint).toBe("newer");
  });
});

describe("proposeThroughCore", () => {
  it("delegates to the broker, returning a real ActionProposal", async () => {
    const proposal = await Ai.proposeThroughCore("cardspoke", {
      app: "cards",
      actionType: "cards.create",
      summary: "Create a card",
      effect: { kind: "create", objectType: "card" },
    });
    expect(proposal.actionType).toBe("cards.create");
    expect(proposal.app).toBe("cards");
    expect(["pending", "approved"]).toContain(proposal.status);
  });
});
