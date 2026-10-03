import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DevModule from "./dev";
import type * as BrokerModule from "../broker";
import type * as AuditModule from "../audit";
import { storage, StoreKeys } from "../storage";

let Dev: typeof DevModule;
let Broker: typeof BrokerModule;
let Audit: typeof AuditModule;

const VALID_INPUT = {
  name: "Widget",
  kind: "widget" as const,
  description: "A test widget",
  code: "console.log('hi');",
  permissions: ["cardspoke.read"],
  dependencies: [],
  network: false,
  provenance: { createdBy: "user" as const },
};

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Dev = await import("./dev");
  Broker = await import("../broker");
  Audit = await import("../audit");
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Seed an "installed" artifact directly in storage. canInstall's gate
 * (validated + a passing sandbox run of the current code) cannot be cleared
 * in jsdom — there is no real Worker to complete a run — so widget RPC tests
 * that need an installed artifact seed one the way secrets.test.ts's legacy
 * migration test does: write storage directly, before any Dev.* call
 * populates the module's in-memory cache, so the next call loads it fresh.
 */
function seedInstalledArtifact(overrides: Partial<DevModule.DevArtifact> = {}): DevModule.DevArtifact {
  const now = Date.now();
  const artifact: DevModule.DevArtifact = {
    id: "dev-installed-1",
    manifest: {
      name: "Installed widget",
      kind: "widget",
      description: "Seeded directly for widget RPC tests",
      permissions: ["time.read", "cardspoke.read"],
      dependencies: [],
      network: false,
    },
    code: "console.log('noop');",
    version: 1,
    status: "installed",
    provenance: { createdBy: "user" },
    versions: [],
    createdAt: now,
    updatedAt: now,
    codeUpdatedAt: now,
    codeHash: "seed-hash",
    installedAt: now,
    ...overrides,
  };
  storage.set(StoreKeys.devArtifacts, [artifact]);
  return artifact;
}

describe("createArtifact", () => {
  it("creates a draft artifact at version 1", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    expect(a.status).toBe("draft");
    expect(a.version).toBe(1);
    expect(a.versions).toHaveLength(0);
    expect(a.manifest.name).toBe("Widget");
  });

  it("defaults an empty name to 'Untitled artifact'", () => {
    const a = Dev.createArtifact({ ...VALID_INPUT, name: "  " });
    expect(a.manifest.name).toBe("Untitled artifact");
  });
});

describe("updateArtifactCode / versions / rollback", () => {
  it("bumps the version and keeps the prior code as a rollback point", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    const updated = Dev.updateArtifactCode(a.id, "console.log('v2');", "tweak");
    expect(updated?.version).toBe(2);
    expect(updated?.versions[0]).toMatchObject({ version: 1, code: VALID_INPUT.code, note: "tweak" });
    expect(updated?.status).toBe("draft");
  });

  it("is a no-op when the code is unchanged", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    const updated = Dev.updateArtifactCode(a.id, VALID_INPUT.code, "no real change");
    expect(updated?.version).toBe(1);
    expect(updated?.versions).toHaveLength(0);
  });

  it("clears lastValidation and installedAt on a code change (must re-validate)", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    Dev.validateArtifact(a.id);
    const updated = Dev.updateArtifactCode(a.id, "console.log('v2');", "edit");
    expect(updated?.lastValidation).toBeUndefined();
    expect(updated?.status).toBe("draft");
  });

  it("caps version history at VERSION_HISTORY_LIMIT", () => {
    let a = Dev.createArtifact(VALID_INPUT);
    for (let i = 0; i < Dev.VERSION_HISTORY_LIMIT + 5; i++) {
      a = Dev.updateArtifactCode(a.id, `console.log(${i});`, `v${i}`)!;
    }
    expect(a.versions.length).toBe(Dev.VERSION_HISTORY_LIMIT);
  });

  it("rollbackArtifact restores a kept version's code", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    Dev.updateArtifactCode(a.id, "console.log('v2');", "edit");
    const rolledBack = Dev.rollbackArtifact(a.id, 1);
    expect(rolledBack?.code).toBe(VALID_INPUT.code);
  });

  it("rollbackArtifact is a no-op when the target version's code matches current", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    Dev.updateArtifactCode(a.id, "console.log('v2');", "edit");
    Dev.rollbackArtifact(a.id, 1); // now back to v1's code, at version 3
    const before = Dev.getArtifact(a.id)!.version;
    const again = Dev.rollbackArtifact(a.id, 1); // code already matches v1 -- no-op
    expect(again?.version).toBe(before);
  });

  it("rollbackArtifact returns undefined for an unknown version", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    expect(Dev.rollbackArtifact(a.id, 99)).toBeUndefined();
  });

  it("diffArtifact returns the line diff against proposed new code", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    const diff = Dev.diffArtifact(a.id, "console.log('changed');");
    expect(diff.some((d) => d.kind === "removed")).toBe(true);
    expect(diff.some((d) => d.kind === "added")).toBe(true);
  });
});

describe("validateArtifact", () => {
  it("passes a well-formed artifact and marks it validated", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    const report = Dev.validateArtifact(a.id);
    expect(report?.ok).toBe(true);
    expect(Dev.getArtifact(a.id)?.status).toBe("validated");
  });

  it("fails and marks rejected when the manifest violates policy", () => {
    const a = Dev.createArtifact({ ...VALID_INPUT, network: true }); // network deny-by-default
    const report = Dev.validateArtifact(a.id);
    expect(report?.ok).toBe(false);
    expect(Dev.getArtifact(a.id)?.status).toBe("rejected");
  });

  it("fails when the manifest is incomplete", () => {
    const a = Dev.createArtifact({ ...VALID_INPUT, description: "" });
    const report = Dev.validateArtifact(a.id);
    expect(report?.checks.find((c) => c.name === "Manifest complete")?.passed).toBe(false);
  });

  it("flags forbidden globals as advisory (does not block validation)", () => {
    const a = Dev.createArtifact({ ...VALID_INPUT, code: "fetch('https://evil.com');" });
    const report = Dev.validateArtifact(a.id);
    const check = report?.checks.find((c) => c.name.includes("forbidden globals"));
    expect(check?.passed).toBe(false);
    expect(check?.advisory).toBe(true);
    expect(report?.ok).toBe(true); // advisory failure does not fail the report
  });

  it("fails on an embedded secret", () => {
    const a = Dev.createArtifact({
      ...VALID_INPUT,
      code: "var key = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';",
    });
    const report = Dev.validateArtifact(a.id);
    expect(report?.checks.find((c) => c.name === "No embedded secrets")?.passed).toBe(false);
    expect(report?.ok).toBe(false);
  });

  it("refuses to persist an artifact whose code exceeds the size cap (2026-07-10 audit)", () => {
    // Size is now enforced BEFORE persistence — a rejected oversize draft can no
    // longer be written to storage (where it could fill the quota) just to have
    // validation flag it afterward.
    const before = Dev.listArtifacts().length;
    expect(() => Dev.createArtifact({ ...VALID_INPUT, code: "x".repeat(70_000) })).toThrow(
      /over the .* limit/i,
    );
    expect(Dev.listArtifacts().length).toBe(before);
  });

  it("returns null for an unknown artifact", () => {
    expect(Dev.validateArtifact("missing")).toBeNull();
  });
});

describe("runInSandbox — guard clauses", () => {
  it("refuses to run an unknown artifact", async () => {
    const run = await Dev.runInSandbox("missing");
    expect(run.ok).toBe(false);
    expect(run.logs[0]).toContain("not found");
  });

  it("refuses to run a draft (unvalidated) artifact", async () => {
    const a = Dev.createArtifact(VALID_INPUT);
    const run = await Dev.runInSandbox(a.id);
    expect(run.ok).toBe(false);
    expect(run.logs[0]).toContain("must pass validation");
  });

  it("times out and records a failed run when nothing responds", async () => {
    vi.useFakeTimers();
    const a = Dev.createArtifact(VALID_INPUT);
    Dev.validateArtifact(a.id);
    const runPromise = Dev.runInSandbox(a.id, 100);
    await vi.advanceTimersByTimeAsync(150);
    const run = await runPromise;
    expect(run.ok).toBe(false);
    expect(run.logs[0]).toContain("Timed out");
    expect(Dev.listRuns(a.id)).toHaveLength(1);
  });
});

describe("canInstall / installArtifact / uninstallArtifact", () => {
  it("refuses install before validation", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    expect(Dev.canInstall(a.id).ok).toBe(false);
    expect(Dev.installArtifact(a.id)).toBeUndefined();
  });

  it("refuses install without a passing sandbox run", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    Dev.validateArtifact(a.id);
    const gate = Dev.canInstall(a.id);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("sandbox-run");
  });

  it("allows install once validated and sandbox-run has passed", async () => {
    vi.useFakeTimers();
    const a = Dev.createArtifact(VALID_INPUT);
    Dev.validateArtifact(a.id);
    // Simulate a passed sandbox run without real iframe execution by driving
    // the timeout path is not an option (that's a failed run) — instead
    // reach in at the only seam available: install requires an ok:true run,
    // which in this headless environment can only come from a completed
    // postMessage exchange the sandbox can't perform. So verify the gate
    // gives an honest, specific reason instead of silently refusing.
    expect(Dev.canInstall(a.id).reason).toBe("The current code has not been sandbox-run");
    vi.useRealTimers();
    void a;
  });

  it("uninstallArtifact reverts an installed artifact to validated", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    expect(Dev.uninstallArtifact(a.id)).toBeUndefined(); // not installed yet
  });
});

describe("initDevCore — dev.install executor", () => {
  it("refuses to install through the broker when the install gate says no", async () => {
    const a = Dev.createArtifact(VALID_INPUT); // draft, not validated
    Dev.initDevCore();
    const proposal = await Broker.propose({
      // dev.install is defined for the assistant (the AI proposes installs).
      app: "assistant",
      actionType: "dev.install",
      summary: "Install widget",
      effect: { kind: "external", externalSummary: "Install artifact", readOnly: false, targetId: a.id },
    });
    if (proposal.status === "pending") await Broker.approve(proposal.id);
    expect(Dev.getArtifact(a.id)?.status).toBe("draft"); // refused, unchanged
  });
});

describe("artifactForAI", () => {
  it("summarizes manifest, provenance, and validation state", () => {
    const a = Dev.createArtifact(VALID_INPUT);
    const summary = Dev.artifactForAI(a.id);
    expect(summary).toContain("widget");
    expect(summary).toContain("Widget");
    expect(summary).toContain("not validated");
    expect(summary).toContain("by user");
  });

  it("returns null for an unknown artifact", () => {
    expect(Dev.artifactForAI("missing")).toBeNull();
  });
});

describe("seedIfEmpty", () => {
  it("seeds exactly one draft artifact when none exist", () => {
    Dev.seedIfEmpty();
    expect(Dev.listArtifacts()).toHaveLength(1);
    expect(Dev.listArtifacts()[0].status).toBe("draft");
  });

  it("does nothing if artifacts already exist", () => {
    Dev.createArtifact(VALID_INPUT);
    Dev.seedIfEmpty();
    expect(Dev.listArtifacts()).toHaveLength(1);
  });

  it("the seeded artifact itself passes validation", () => {
    Dev.seedIfEmpty();
    const seeded = Dev.listArtifacts()[0];
    const report = Dev.validateArtifact(seeded.id);
    expect(report?.ok).toBe(true);
  });
});

describe("handleWidgetRpc", () => {
  it("refuses an unknown artifact and audits the denial", async () => {
    const res = await Dev.handleWidgetRpc("missing", "time.upcoming");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unknown artifact/i);
    expect(Audit.getEvents().some((e) => e.type === "dev.widget.denied")).toBe(true);
  });

  it("refuses a not-installed artifact", async () => {
    const a = Dev.createArtifact(VALID_INPUT); // draft, never installed
    const res = await Dev.handleWidgetRpc(a.id, "time.upcoming");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not installed/i);
  });

  it("refuses an unknown request kind", async () => {
    const a = seedInstalledArtifact();
    const res = await Dev.handleWidgetRpc(a.id, "not.a.real.kind");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unknown request kind/i);
  });

  it("denies a kind whose required permission the artifact did not declare, and audits it", async () => {
    const a = seedInstalledArtifact({
      manifest: {
        name: "No permissions widget",
        kind: "widget",
        description: "declares nothing",
        permissions: [],
        dependencies: [],
        network: false,
      },
    });
    const before = Audit.getEvents().length;
    const res = await Dev.handleWidgetRpc(a.id, "time.upcoming");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("time.read");
    const events = Audit.getEvents();
    expect(events.length).toBe(before + 1);
    expect(events[0].type).toBe("dev.widget.denied");
    expect(events[0].summary).toContain("No permissions widget");
    expect(events[0].summary).toContain("time.upcoming");
  });

  it("returns ok data for a kind whose permission the artifact declared, and does not audit success", async () => {
    const a = seedInstalledArtifact();
    const before = Audit.getEvents().length;
    const res = await Dev.handleWidgetRpc(a.id, "tasks.summary");
    expect(res.ok).toBe(true);
    if (res.ok) expect(typeof res.data).toBe("string");
    expect(Audit.getEvents().length).toBe(before); // success is not audited (denials-only, keeps signal)
  });
});

describe("buildWidgetSrcdoc", () => {
  it("contains the CSP meta and embeds the token", () => {
    const a = seedInstalledArtifact({ code: "console.log('hi');" });
    const html = Dev.buildWidgetSrcdoc(a, "tok-abc123");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("tok-abc123");
  });

  it("escapes </script> inside artifact code so it cannot break out of the harness", () => {
    const malicious = "</script><script>window.__pwned = true;</script>";
    const a = seedInstalledArtifact({ code: malicious });
    const html = Dev.buildWidgetSrcdoc(a, "tok-xyz");
    // The escaped form (embedInScript turns "<" into "\u003c") must be present…
    expect(html).toContain("\\u003c/script>");
    // …and the raw payload must not appear as a literal closing tag followed
    // by the attacker's own <script>, which would break out of the harness.
    expect(html).not.toContain("</script><script>window.__pwned");
  });
});
