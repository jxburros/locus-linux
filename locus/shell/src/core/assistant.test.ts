import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AssistantModule from "./assistant";
import type * as ModelRuntimeModule from "./modelRuntime";
import type * as StorageModule from "./storage";
import type * as BrokerModule from "./broker";

let Assistant: typeof AssistantModule;
let ModelRuntime: typeof ModelRuntimeModule;
let Storage: typeof StorageModule;
let Broker: typeof BrokerModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Assistant = await import("./assistant");
  ModelRuntime = await import("./modelRuntime");
  Storage = await import("./storage");
  Broker = await import("./broker");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setProvider(provider: "none" | "local" | "cloud"): void {
  Storage.storage.set(Storage.StoreKeys.aiProvider, provider);
}

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("interpretAsync — falls back to interpret() when the runtime is disabled", () => {
  it("returns the same turn interpret() would, for a read-only prompt", async () => {
    const sync = Assistant.interpret("how many tasks are open", null);
    const asyncTurn = await Assistant.interpretAsync("how many tasks are open", null);
    expect(asyncTurn).toEqual(sync);
  });

  it("does not touch fetch at all when disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await Assistant.interpretAsync("what can you see", null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("interpretAsync — enabled but misconfigured", () => {
  it("appends the refusal reason to the rule-based via", async () => {
    // enabled, but no endpoint/model/provider configured — canDispatch() refuses.
    ModelRuntime.setModelRuntimeConfig({ enabled: true });
    const turn = await Assistant.interpretAsync("how many tasks are open", null);
    expect(turn.via).toContain("model runtime:");
  });
});

describe("interpretAsync — routing rule requires local but the endpoint is remote", () => {
  it("falls back to interpret() with an explanatory via", async () => {
    setProvider("cloud");
    ModelRuntime.setModelRuntimeConfig({
      enabled: true,
      endpointUrl: "https://api.example.com",
      model: "gpt",
      allowRemote: true,
    });
    const turn = await Assistant.interpretAsync("how many tasks are open", null);
    expect(turn.via).toContain("routing rule requires local; endpoint is remote");
  });
});

describe("interpretAsync — dispatch success", () => {
  it("returns an AnswerTurn with a model via string when no action is parsed", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse("The answer is 42.")));

    const turn = await Assistant.interpretAsync("what is the answer", null);
    expect(turn.kind).toBe("answer");
    if (turn.kind === "answer") {
      expect(turn.text).toBe("The answer is 42.");
    }
    expect(turn.via).toContain("model llama3 @ localhost:11434");
  });

  it("turns a parsed model action into a ProposalTurn that commits a real proposal through the broker", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    const content = '```json\n{"action":"create_task","title":"Buy milk"}\n```';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(content)));

    const turn = await Assistant.interpretAsync("add a task to buy milk", null);
    expect(turn.kind).toBe("proposal");
    if (turn.kind !== "proposal") throw new Error("expected a proposal turn");
    expect(turn.summary).toContain("Model-proposed");
    expect(turn.summary).toContain("Buy milk");

    turn.commit();
    await vi.waitFor(() => {
      const proposals = Broker.getProposals();
      expect(proposals.some((p) => p.actionType === "tasks.create")).toBe(true);
    });
  });
});

describe("interpretAsync — dispatch failure falls back honestly", () => {
  it("falls back to interpret() with a 'model unreachable' via", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const turn = await Assistant.interpretAsync("how many tasks are open", null);
    expect(turn.via).toContain("model unreachable");
    expect(turn.via).toContain("local rules");
    // Still produced the honest rule-based read, not an error turn.
    expect(turn.kind).toBe("answer");
  });
});

describe("interpret() is untouched by the model runtime", () => {
  it("ignores model runtime config entirely — same output whether enabled or not", async () => {
    const before = Assistant.interpret("add task: write the changelog", null);
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    setProvider("local");
    const after = Assistant.interpret("add task: write the changelog", null);
    expect(after.kind).toBe(before.kind);
    if (before.kind !== "proposal" || after.kind !== "proposal") {
      throw new Error("expected proposal turns");
    }
    expect(after.summary).toBe(before.summary);
  });
});
