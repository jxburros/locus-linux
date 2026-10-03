import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BrokerModule from "./broker";
import type * as StorageModule from "./storage";
import type { ActionProposal, AppId } from "@/types";

// The Broker had no dedicated suite before this pass. These tests lock in the
// security-critical behavior added while resolving the 2026-07-10 audit:
// fail-closed authorization, effect-payload redaction, once-only executor
// registration, and truthful (async-aware) external-executor outcomes.

let Broker: typeof BrokerModule;
let Storage: typeof StorageModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Broker = await import("./broker");
  Storage = await import("./storage");
});

/** Seed an already-approved external proposal straight into storage. The
    actionType/app pair must be a REAL Action Definition (execution
    re-authorizes against the registry — unknown actions deny by default). */
function seedApprovedExternal(
  actionType: string,
  app: AppId = "files",
  readOnly = true,
): string {
  const p: ActionProposal = {
    id: "prop-test-1",
    createdAt: Date.now(),
    app,
    actionType,
    summary: "test external",
    effect: { kind: "external", externalSummary: "do a thing", readOnly },
    tier: "writableWithApproval",
    status: "approved",
  };
  Storage.storage.set(Storage.StoreKeys.proposals, [p]);
  return p.id;
}

describe("propose — fail-closed authorization", () => {
  it("denies a proposal from an app with no capability manifest", async () => {
    const p = await Broker.propose({
      app: "not-a-real-app" as AppId,
      actionType: "tasks.create",
      summary: "create a task",
      effect: { kind: "create", objectType: "task", payload: { title: "x" } },
    });
    expect(p.status).toBe("denied");
    expect(p.error).toMatch(/no capability manifest/i);
  });
});

describe("propose — effect payload redaction (F5)", () => {
  it("redacts a pasted secret in the effect payload, not just the summary", async () => {
    const key = "sk-abcdefghijklmnopqrstuvwxyz1234";
    const p = await Broker.propose({
      app: "tasks",
      actionType: "tasks.create",
      summary: `remember ${key}`,
      effect: { kind: "create", objectType: "task", payload: { title: `token ${key}`, body: key } },
    });
    // Whatever the verdict, the persisted effect must not carry the raw secret.
    const stored = Storage.storage.get<ActionProposal[]>(Storage.StoreKeys.proposals, []);
    const found = stored.find((x) => x.id === p.id)!;
    expect(JSON.stringify(found.effect)).not.toContain(key);
    expect(found.summary).not.toContain(key);
  });
});

describe("registerExternalExecutor — structural ownership", () => {
  it("keeps the first-registered executor and ignores a later duplicate", async () => {
    const ran: string[] = [];
    Broker.registerExternalExecutor("files.access", () => {
      ran.push("first");
    });
    Broker.registerExternalExecutor("files.access", () => {
      ran.push("second");
    });
    const id = seedApprovedExternal("files.access");
    await Broker.execute(id);
    expect(ran).toEqual(["first"]);
  });

  it("refuses an executor for an actionType with no Action Definition", async () => {
    const ran: string[] = [];
    Broker.registerExternalExecutor("rogue.hijack", () => {
      ran.push("rogue");
    });
    // No definition → nothing registered, and executing an unknown action is
    // denied by the Security gate anyway.
    const id = seedApprovedExternal("rogue.hijack");
    const out = await Broker.execute(id);
    expect(ran).toEqual([]);
    expect(out?.status).toBe("denied");
  });
});

describe("execute — default-deny for unknown/mismatched actions", () => {
  it("denies executing a persisted proposal whose actionType has no definition", async () => {
    const id = seedApprovedExternal("not.registered");
    const out = await Broker.execute(id);
    expect(out?.status).toBe("denied");
    expect(out?.error).toMatch(/no action definition/i);
  });

  it("denies executing a proposal whose app does not own the action", async () => {
    const id = seedApprovedExternal("web.pageContext", "files");
    const out = await Broker.execute(id);
    expect(out?.status).toBe("denied");
  });
});

describe("execute — truthful external outcomes", () => {
  it("marks executing then executed for async work", async () => {
    let resolveFn: (v: void) => void = () => {};
    const gate = new Promise<void>((r) => (resolveFn = r));
    Broker.registerExternalExecutor("files.access", async () => {
      await gate;
      return { status: "succeeded" as const, detail: "done" };
    });
    const id = seedApprovedExternal("files.access");
    const during = await Broker.execute(id);
    expect(during?.status).toBe("executing");
    resolveFn();
    await gate;
    await Promise.resolve();
    await Promise.resolve();
    const after = Broker.getProposals().find((x) => x.id === id);
    expect(after?.status).toBe("executed");
  });

  it("records failure (not success) when a synchronous executor throws", async () => {
    Broker.registerExternalExecutor("web.pageContext", () => {
      throw new Error("refused");
    });
    const id = seedApprovedExternal("web.pageContext", "web");
    const out = await Broker.execute(id);
    expect(out?.status).toBe("failed");
    expect(out?.error).toMatch(/refused/);
  });

  it("records failure when an executor returns a failed outcome", async () => {
    Broker.registerExternalExecutor("time.reminder", () => ({
      status: "failed" as const,
      detail: "nope",
    }));
    const id = seedApprovedExternal("time.reminder", "time", false);
    const out = await Broker.execute(id);
    expect(out?.status).toBe("failed");
  });
});
