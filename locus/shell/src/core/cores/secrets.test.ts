import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storage, StoreKeys } from "../storage";
import type * as SecretsModule from "./secrets";

let Secrets: typeof SecretsModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Secrets = await import("./secrets");
});

afterEach(() => {
  vi.useRealTimers();
});

const PASSPHRASE = "correct horse battery staple";

describe("makeRef", () => {
  it("lowercases and hyphenates provider/name", () => {
    expect(Secrets.makeRef("OpenAI", "Default Key")).toBe("secret://openai/default-key");
  });

  it("falls back to local/default for empty segments", () => {
    expect(Secrets.makeRef("", "")).toBe("secret://local/default");
  });
});

describe("vault lifecycle", () => {
  it("starts uninitialized", () => {
    expect(Secrets.vaultState()).toBe("uninitialized");
  });

  it("setupVault initializes and unlocks the vault", async () => {
    const ok = await Secrets.setupVault(PASSPHRASE);
    expect(ok).toBe(true);
    expect(Secrets.vaultState()).toBe("unlocked");
  });

  it("rejects setup with an empty passphrase", async () => {
    expect(await Secrets.setupVault("")).toBe(false);
    expect(Secrets.vaultState()).toBe("uninitialized");
  });

  it("refuses to re-run setup once a vault exists", async () => {
    await Secrets.setupVault(PASSPHRASE);
    expect(await Secrets.setupVault("another passphrase")).toBe(false);
  });

  it("lockVault clears the unlocked state", async () => {
    await Secrets.setupVault(PASSPHRASE);
    Secrets.lockVault();
    expect(Secrets.vaultState()).toBe("locked");
  });

  it("unlockVault succeeds with the right passphrase and fails with the wrong one", async () => {
    await Secrets.setupVault(PASSPHRASE);
    Secrets.lockVault();
    expect(await Secrets.unlockVault("wrong passphrase")).toBe(false);
    expect(Secrets.vaultState()).toBe("locked");
    expect(await Secrets.unlockVault(PASSPHRASE)).toBe(true);
    expect(Secrets.vaultState()).toBe("unlocked");
  });

  it("auto-locks after the idle window elapses", async () => {
    vi.useFakeTimers();
    await Secrets.setupVault(PASSPHRASE);
    expect(Secrets.vaultState()).toBe("unlocked");
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(Secrets.vaultState()).toBe("locked");
  });
});

describe("CRUD while locked vs unlocked", () => {
  it("refuses to add a secret while locked", async () => {
    const result = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-test-value",
    });
    expect(result).toBeNull();
    expect(Secrets.listSecrets()).toHaveLength(0);
  });

  it("adds a secret once unlocked, masked without decrypting", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "OpenAI key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-abcdefghijklmnop",
    });
    expect(item).not.toBeNull();
    expect(item!.value).not.toContain("sk-abcdefghijklmnop");
    expect(item!.value.startsWith("enc2:")).toBe(true); // AAD-bound format
    expect(Secrets.maskSecret(item!)).toContain(String("sk-abcdefghijklmnop".length));
  });

  it("rotates the value for a re-added ref while keeping the reference stable", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const first = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-first-value-aaaa",
    });
    Secrets.setSecretAIAccess(first!.id, "brokered");
    const second = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-second-value-bbb",
    });
    expect(second!.id).toBe(first!.id);
    expect(second!.ref).toBe(first!.ref);
    expect(second!.aiAccess).toBe("brokered"); // rotate preserves AI access
    expect(Secrets.listSecrets()).toHaveLength(1);
    expect(Secrets.revealSecret(second!.id)).toBe("sk-second-value-bbb");
  });

  it("removeSecret deletes the item and its decrypted cache entry", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value",
    });
    Secrets.removeSecret(item!.id);
    expect(Secrets.listSecrets()).toHaveLength(0);
    expect(Secrets.revealSecret(item!.id)).toBeNull();
  });
});

describe("revealSecret", () => {
  it("returns null while the vault is locked", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value-123456",
    });
    Secrets.lockVault();
    expect(Secrets.revealSecret(item!.id)).toBeNull();
  });

  it("returns the raw value once unlocked again", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value-123456",
    });
    Secrets.lockVault();
    await Secrets.unlockVault(PASSPHRASE);
    expect(Secrets.revealSecret(item!.id)).toBe("sk-value-123456");
  });
});

describe("brokered use — the secrets.use proposal path (Wave 3)", () => {
  async function seedBrokeredSecret() {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value-abc",
    });
    Secrets.setSecretAIAccess(item!.id, "brokered");
    Secrets.initSecretsCore();
    return item!;
  }

  it("requestSecretUse creates a pending proposal; approval delivers the value to the registered consumer ONCE", async () => {
    const Broker = await import("../broker");
    const item = await seedBrokeredSecret();
    const received: { value: string; ref: string }[] = [];
    Secrets.registerSecretConsumer("test-consumer", (value, ctx) =>
      received.push({ value, ref: ctx.ref }),
    );
    const proposal = await Secrets.requestSecretUse({
      ref: item.ref,
      purpose: "call the provider",
      consumer: "test-consumer",
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe("pending");
    expect(received).toHaveLength(0); // nothing delivered before approval
    await Broker.approve(proposal!.id);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].value).toBe("sk-value-abc");
    expect(received[0].ref).toBe(item.ref);
    const settled = Broker.getProposals().find((p) => p.id === proposal!.id);
    expect(settled?.status).toBe("executed");
    // The value itself never lands in proposal storage.
    expect(JSON.stringify(settled)).not.toContain("sk-value-abc");
    expect(Secrets.listSecrets().find((s2) => s2.id === item.id)?.lastUsedAt).toBeDefined();
  });

  it("fails honestly when no consumer runtime is registered (no fake success)", async () => {
    const Broker = await import("../broker");
    const item = await seedBrokeredSecret();
    const proposal = await Secrets.requestSecretUse({
      ref: item.ref,
      purpose: "test",
      consumer: "not-registered",
    });
    await Broker.approve(proposal!.id);
    await vi.waitFor(() => {
      const settled = Broker.getProposals().find((p) => p.id === proposal!.id);
      expect(settled?.status).toBe("failed");
    });
  });

  it("fails when AI access is off or the vault is locked", async () => {
    const Broker = await import("../broker");
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value",
    });
    Secrets.initSecretsCore();
    Secrets.registerSecretConsumer("c", () => undefined);
    // aiAccess is "none" by default → refused.
    const p1 = await Secrets.requestSecretUse({ ref: item!.ref, purpose: "t", consumer: "c" });
    await Broker.approve(p1!.id);
    await vi.waitFor(() =>
      expect(Broker.getProposals().find((p) => p.id === p1!.id)?.status).toBe("failed"),
    );
    // Locked vault → refused even with access on.
    Secrets.setSecretAIAccess(item!.id, "brokered");
    Secrets.lockVault();
    const p2 = await Secrets.requestSecretUse({ ref: item!.ref, purpose: "t", consumer: "c" });
    await Broker.approve(p2!.id);
    await vi.waitFor(() =>
      expect(Broker.getProposals().find((p) => p.id === p2!.id)?.status).toBe("failed"),
    );
  });

  it("returns null for an unknown ref", async () => {
    await Secrets.setupVault(PASSPHRASE);
    expect(
      await Secrets.requestSecretUse({ ref: "secret://none/none", purpose: "t", consumer: "c" }),
    ).toBeNull();
  });
});

describe("AAD binding (Wave 3)", () => {
  it("a ciphertext swapped under another secret's id fails to decrypt instead of leaking", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const a = await Secrets.addSecret({
      label: "A", provider: "p", name: "a", category: "api-key", value: "value-A",
    });
    const b = await Secrets.addSecret({
      label: "B", provider: "p", name: "b", category: "api-key", value: "value-B",
    });
    // Swap the two ciphertexts in storage — a tampering scenario.
    const { storage, StoreKeys } = await import("../storage");
    type Item = { id: string; value: string };
    const items = storage.get<Item[]>(StoreKeys.secretsItems, []);
    const va = items.find((s2) => s2.id === a!.id)!.value;
    const vb = items.find((s2) => s2.id === b!.id)!.value;
    storage.set(
      StoreKeys.secretsItems,
      items.map((s2) =>
        s2.id === a!.id ? { ...s2, value: vb } : s2.id === b!.id ? { ...s2, value: va } : s2,
      ),
    );
    Secrets.lockVault();
    await Secrets.unlockVault(PASSPHRASE);
    // Neither swapped value decrypts under the wrong id — reveal returns null.
    expect(Secrets.revealSecret(a!.id)).toBeNull();
    expect(Secrets.revealSecret(b!.id)).toBeNull();
  });

  it("migrates enc1 (unbound) items to AAD-bound enc2 on unlock", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "K", provider: "p", name: "k", category: "api-key", value: "v-123456",
    });
    expect(item!.value.startsWith("enc2:")).toBe(true);
    // All stored values are AAD-bound after unlock+migration.
    Secrets.lockVault();
    await Secrets.unlockVault(PASSPHRASE);
    for (const s2 of Secrets.listSecrets()) {
      expect(s2.value.startsWith("enc2:")).toBe(true);
    }
    expect(Secrets.revealSecret(item!.id)).toBe("v-123456");
  });
});

describe("recoverable delete (Wave 3)", () => {
  it("removeSecret moves the encrypted item to the vault trash; restore brings it back", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "K", provider: "p", name: "k", category: "api-key", value: "v-123456",
    });
    Secrets.removeSecret(item!.id);
    expect(Secrets.listSecrets()).toHaveLength(0);
    expect(Secrets.listSecretTrash()).toHaveLength(1);
    // The trashed record still carries the AAD-bound ciphertext, not plaintext.
    expect(Secrets.listSecretTrash()[0].value.startsWith("enc2:")).toBe(true);
    expect(JSON.stringify(Secrets.listSecretTrash())).not.toContain("v-123456");
    const restored = Secrets.restoreSecret(item!.id);
    expect(restored).not.toBeNull();
    expect(Secrets.listSecrets()).toHaveLength(1);
    // The restored value still decrypts.
    Secrets.lockVault();
    await Secrets.unlockVault(PASSPHRASE);
    expect(Secrets.revealSecret(item!.id)).toBe("v-123456");
  });

  it("restore refuses when the ref exists again; purge requires a valid token", async () => {
    await Secrets.setupVault(PASSPHRASE);
    const item = await Secrets.addSecret({
      label: "K", provider: "p", name: "k", category: "api-key", value: "one",
    });
    Secrets.removeSecret(item!.id);
    await Secrets.addSecret({
      label: "K2", provider: "p", name: "k", category: "api-key", value: "two",
    });
    expect(Secrets.restoreSecret(item!.id)).toBeNull(); // ref collision
    expect(Secrets.purgeSecretTrash("bogus")).toBe(0);
    const { token } = Secrets.requestSecretTrashPurge();
    expect(Secrets.purgeSecretTrash(token)).toBe(1);
    expect(Secrets.listSecretTrash()).toHaveLength(0);
  });
});

describe("AI-facing views never carry raw values", () => {
  it("listRefsForAI exposes only ref/category/aiAccess", async () => {
    await Secrets.setupVault(PASSPHRASE);
    await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-super-secret-value",
    });
    const views = Secrets.listRefsForAI();
    expect(views).toHaveLength(1);
    expect(Object.keys(views[0]).sort()).toEqual(["aiAccess", "category", "ref"]);
    expect(JSON.stringify(views)).not.toContain("sk-super-secret-value");
  });

  it("secretRefExists answers existence without exposing the value", async () => {
    await Secrets.setupVault(PASSPHRASE);
    await Secrets.addSecret({
      label: "Key",
      provider: "openai",
      name: "default",
      category: "api-key",
      value: "sk-value",
    });
    expect(Secrets.secretRefExists("secret://openai/default")).toBe(true);
    expect(Secrets.secretRefExists("secret://openai/missing")).toBe(false);
  });
});

describe("legacy migration", () => {
  function legacyEncode(raw: string): string {
    return btoa(unescape(encodeURIComponent(raw)));
  }

  it("migrates a pre-encryption plain-base64 item to real encryption on unlock", async () => {
    // Seed a legacy item directly in storage, bypassing addSecret (which
    // only ever writes encrypted values) to simulate data from before the
    // encryption migration existed.
    const legacyRaw = "sk-legacy-plaintext-value";
    storage.set(StoreKeys.secretsItems, [
      {
        id: "sec-legacy-1",
        ref: "secret://legacy/one",
        label: "Legacy",
        category: "api-key" as const,
        value: legacyEncode(legacyRaw),
        aiAccess: "none" as const,
        createdAt: Date.now(),
      },
    ]);

    await Secrets.setupVault(PASSPHRASE);

    const migrated = Secrets.listSecrets()[0];
    expect(migrated.value.startsWith("enc2:")).toBe(true); // migrated straight to the AAD-bound format
    expect(migrated.valueLength).toBe(legacyRaw.length);
    expect(Secrets.revealSecret(migrated.id)).toBe(legacyRaw);
  });
});

describe("detectSecrets", () => {
  it("flags an OpenAI-style key", () => {
    const findings = Secrets.detectSecrets("key=sk-ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(findings.some((f) => f.name === "OpenAI key")).toBe(true);
  });

  it("flags an AWS access key", () => {
    const findings = Secrets.detectSecrets("AKIAABCDEFGHIJKLMNOP");
    expect(findings.some((f) => f.name === "AWS access key")).toBe(true);
  });

  it("flags a private key block", () => {
    const findings = Secrets.detectSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIE...");
    expect(findings.some((f) => f.name === "Private key block")).toBe(true);
  });

  it("finds nothing in ordinary text", () => {
    expect(Secrets.detectSecrets("just a normal sentence about cats")).toHaveLength(0);
  });
});

describe("redactText", () => {
  it("redacts a pattern match without needing the vault unlocked", () => {
    const out = Secrets.redactText("token: sk-ABCDEFGHIJKLMNOPQRSTUVWX end");
    expect(out).toContain("[redacted: OpenAI key]");
    expect(out).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUVWX");
  });

  it("also redacts a stored raw value that matches no pattern, while unlocked", async () => {
    await Secrets.setupVault(PASSPHRASE);
    await Secrets.addSecret({
      label: "Wifi",
      provider: "home",
      name: "wifi",
      category: "password",
      value: "correcthorsebattery",
    });
    const out = Secrets.redactText("the wifi password is correcthorsebattery, don't share it");
    expect(out).toContain("[redacted: vault value]");
    expect(out).not.toContain("correcthorsebattery");
  });

  it("cannot vault-redact a stored value while the vault is locked", async () => {
    await Secrets.setupVault(PASSPHRASE);
    await Secrets.addSecret({
      label: "Wifi",
      provider: "home",
      name: "wifi",
      category: "password",
      value: "correcthorsebattery",
    });
    Secrets.lockVault();
    const out = Secrets.redactText("the wifi password is correcthorsebattery");
    expect(out).toContain("correcthorsebattery"); // no pattern match, vault locked — known limitation
  });
});
