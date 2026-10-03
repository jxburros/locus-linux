import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ModelRuntimeModule from "./modelRuntime";
import type * as StorageModule from "./storage";
import type * as SecretsModule from "./cores/secrets";
import type * as BrokerModule from "./broker";
import type * as AuditModule from "./audit";
import type { AIContextPacket } from "@/types";

let ModelRuntime: typeof ModelRuntimeModule;
let Storage: typeof StorageModule;
let Secrets: typeof SecretsModule;
let Broker: typeof BrokerModule;
let Audit: typeof AuditModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  ModelRuntime = await import("./modelRuntime");
  Storage = await import("./storage");
  Secrets = await import("./cores/secrets");
  Broker = await import("./broker");
  Audit = await import("./audit");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PASSPHRASE = "correct horse battery staple";

function fakePacket(): AIContextPacket {
  return {
    activeApp: null,
    activeWorkspace: "Test",
    selectedObjectId: null,
    visibleAnchors: [],
    scopedApps: [],
    readableCapabilities: [],
    retrievedSources: [],
    recentActivity: [],
    objectCount: 0,
    coreSummaries: [],
    userVisibilitySummary: "Test workspace summary.",
  };
}

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setProvider(provider: "none" | "local" | "cloud"): void {
  Storage.storage.set(Storage.StoreKeys.aiProvider, provider);
}

describe("endpointClass", () => {
  it("classifies an empty or garbage URL as invalid", () => {
    expect(ModelRuntime.endpointClass("")).toBe("invalid");
    expect(ModelRuntime.endpointClass("not a url")).toBe("invalid");
  });

  it("rejects a non-http(s) scheme", () => {
    expect(ModelRuntime.endpointClass("ftp://example.com")).toBe("invalid");
  });

  it("rejects a URL carrying embedded credentials", () => {
    expect(ModelRuntime.endpointClass("http://user:pass@localhost:11434")).toBe("invalid");
  });

  it("classifies localhost/private hosts as local", () => {
    expect(ModelRuntime.endpointClass("http://localhost:11434")).toBe("local");
    expect(ModelRuntime.endpointClass("http://127.0.0.1:8080")).toBe("local");
    expect(ModelRuntime.endpointClass("http://192.168.1.5:8080")).toBe("local");
  });

  it("classifies a public host as remote", () => {
    expect(ModelRuntime.endpointClass("https://api.openai.com")).toBe("remote");
  });
});

describe("dispatchModelTurn — fail-closed refusals never touch fetch", () => {
  it("refuses when the runtime is disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ endpointUrl: "http://localhost:11434", model: "llama3" });
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses when the AI provider is None", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses on an invalid endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "not a url", model: "llama3" });
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a remote endpoint without allowRemote", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setProvider("cloud");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "https://api.example.com", model: "gpt" });
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a remote endpoint with allowRemote when the provider is local, not cloud", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({
      enabled: true,
      endpointUrl: "https://api.example.com",
      model: "gpt",
      allowRemote: true,
    });
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses when no model name is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "" });
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("dispatchModelTurn — a local, enabled, provider-matched endpoint dispatches", () => {
  it("POSTs /v1/chat/completions with the expected body and no Authorization header", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    const fetchSpy = vi.fn().mockResolvedValue(okResponse("hello there"));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("hello there");
      expect(result.model).toBe("llama3");
      expect(result.endpointHost).toBe("localhost:11434");
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(opts.credentials).toBe("omit");
    expect(opts.referrerPolicy).toBe("no-referrer");
    expect(opts.cache).toBe("no-store");
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe("llama3");
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("does not double an endpoint URL that already ends in /v1", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434/v1", model: "llama3" });
    const fetchSpy = vi.fn().mockResolvedValue(okResponse("hi"));
    vi.stubGlobal("fetch", fetchSpy);
    await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("returns a typed failure on a non-2xx response", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
  });

  it("returns a typed failure when fetch throws (network error)", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const result = await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("connection refused");
  });

  it("includes an Authorization header once an approved secrets.use proposal arms the session key", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });

    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-runtime-value",
    });
    Secrets.setSecretAIAccess(item!.id, "brokered");
    Secrets.initSecretsCore();
    ModelRuntime.initModelRuntime();
    ModelRuntime.setModelRuntimeConfig({ apiKeySecretRef: item!.ref });

    expect(ModelRuntime.hasSessionKey()).toBe(false);
    const proposal = await ModelRuntime.requestRuntimeKey();
    expect(proposal).not.toBeNull();
    await Broker.approve(proposal!.id);
    await vi.waitFor(() => expect(ModelRuntime.hasSessionKey()).toBe(true));

    const fetchSpy = vi.fn().mockResolvedValue(okResponse("hi"));
    vi.stubGlobal("fetch", fetchSpy);
    await ModelRuntime.dispatchModelTurn({ prompt: "hi", packet: fakePacket() });
    const opts = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer sk-runtime-value");
  });

  it("records an ai.dispatched audit event with model/host, never the prompt or key", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse("the plan mentions SECRET-VALUE-XYZ inline")),
    );
    await ModelRuntime.dispatchModelTurn({
      prompt: "a very private prompt about my finances",
      packet: fakePacket(),
    });
    const events = Audit.getEvents();
    const dispatched = events.find((e) => e.type === "ai.dispatched");
    expect(dispatched).toBeDefined();
    expect(dispatched!.summary).toContain("llama3");
    expect(dispatched!.summary).toContain("localhost:11434");
    expect(dispatched!.summary).toContain("ok");
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("a very private prompt about my finances");
    expect(serialized).not.toContain("SECRET-VALUE-XYZ");
  });
});

describe("canTestConnection — ignores the model-name check", () => {
  it("is ok without a model name when everything else is satisfied", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "" });
    expect(ModelRuntime.canDispatch().ok).toBe(false);
    expect(ModelRuntime.canTestConnection().ok).toBe(true);
  });

  it("still refuses a remote endpoint without allowRemote", async () => {
    setProvider("cloud");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "https://api.example.com", model: "" });
    expect(ModelRuntime.canTestConnection().ok).toBe(false);
  });
});

describe("setModelRuntimeConfig — session-key + re-acknowledgment hygiene", () => {
  it("clears the session key when the endpoint changes", async () => {
    setProvider("local");
    ModelRuntime.setModelRuntimeConfig({ enabled: true, endpointUrl: "http://localhost:11434", model: "llama3" });
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value",
    });
    Secrets.setSecretAIAccess(item!.id, "brokered");
    Secrets.initSecretsCore();
    ModelRuntime.initModelRuntime();
    ModelRuntime.setModelRuntimeConfig({ apiKeySecretRef: item!.ref });
    const proposal = await ModelRuntime.requestRuntimeKey();
    await Broker.approve(proposal!.id);
    await vi.waitFor(() => expect(ModelRuntime.hasSessionKey()).toBe(true));

    ModelRuntime.setModelRuntimeConfig({ endpointUrl: "http://localhost:9999" });
    expect(ModelRuntime.hasSessionKey()).toBe(false);
  });

  it("resets allowRemote to false when the endpoint changes without re-asserting it", () => {
    setProvider("cloud");
    ModelRuntime.setModelRuntimeConfig({
      enabled: true,
      endpointUrl: "https://api.example.com",
      model: "gpt",
      allowRemote: true,
    });
    expect(ModelRuntime.getModelRuntimeConfig().allowRemote).toBe(true);
    ModelRuntime.setModelRuntimeConfig({ endpointUrl: "https://api2.example.com" });
    expect(ModelRuntime.getModelRuntimeConfig().allowRemote).toBe(false);
  });
});

describe("parseModelAction", () => {
  it("parses a valid create_task action from a fenced block", () => {
    const text = 'Sure, here you go:\n```json\n{"action":"create_task","title":"Buy milk"}\n```\n';
    expect(ModelRuntime.parseModelAction(text)).toEqual({ action: "create_task", title: "Buy milk" });
  });

  it("parses a valid create_note action with a body", () => {
    const text = '```json\n{"action":"create_note","title":"Notes","body":"body text"}\n```';
    expect(ModelRuntime.parseModelAction(text)).toEqual({
      action: "create_note",
      title: "Notes",
      body: "body text",
    });
  });

  it("parses create_note without a body", () => {
    const text = '```json\n{"action":"create_note","title":"Notes"}\n```';
    expect(ModelRuntime.parseModelAction(text)).toEqual({ action: "create_note", title: "Notes", body: undefined });
  });

  it("parses a valid set_reminder action (text + when, no title)", () => {
    const text = '```json\n{"action":"set_reminder","text":"call mom","when":"tomorrow morning"}\n```';
    expect(ModelRuntime.parseModelAction(text)).toEqual({
      action: "set_reminder",
      text: "call mom",
      when: "tomorrow morning",
    });
  });

  it("parses whole-string JSON with no fence", () => {
    expect(ModelRuntime.parseModelAction('{"action":"create_task","title":"x"}')).toEqual({
      action: "create_task",
      title: "x",
    });
  });

  it("rejects an unknown action", () => {
    expect(ModelRuntime.parseModelAction('```json\n{"action":"delete_everything","title":"x"}\n```')).toBeNull();
  });

  it("rejects extra keys", () => {
    expect(
      ModelRuntime.parseModelAction('```json\n{"action":"create_task","title":"x","extra":"y"}\n```'),
    ).toBeNull();
  });

  it("rejects wrong types", () => {
    expect(ModelRuntime.parseModelAction('```json\n{"action":"create_task","title":123}\n```')).toBeNull();
  });

  it("rejects an oversized title", () => {
    const long = "a".repeat(201);
    expect(
      ModelRuntime.parseModelAction(`\`\`\`json\n{"action":"create_task","title":"${long}"}\n\`\`\``),
    ).toBeNull();
  });

  it("rejects an oversized note body", () => {
    const long = "a".repeat(4001);
    expect(
      ModelRuntime.parseModelAction(
        `\`\`\`json\n{"action":"create_note","title":"x","body":"${long}"}\n\`\`\``,
      ),
    ).toBeNull();
  });

  it("rejects set_reminder carrying a title instead of text/when", () => {
    expect(ModelRuntime.parseModelAction('```json\n{"action":"set_reminder","title":"x"}\n```')).toBeNull();
  });

  it("rejects more than one fenced block", () => {
    const text =
      '```json\n{"action":"create_task","title":"a"}\n```\nand also\n```json\n{"action":"create_task","title":"b"}\n```';
    expect(ModelRuntime.parseModelAction(text)).toBeNull();
  });

  it("rejects prose with no JSON at all", () => {
    expect(ModelRuntime.parseModelAction("Sure — the answer is 42, no action needed.")).toBeNull();
  });

  it("rejects an empty title", () => {
    expect(ModelRuntime.parseModelAction('```json\n{"action":"create_task","title":""}\n```')).toBeNull();
  });
});
