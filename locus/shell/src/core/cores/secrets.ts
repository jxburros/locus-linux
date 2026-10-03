/*
 * Secrets Core — stores, protects, brokers, and redacts secrets (directive §14).
 * ---------------------------------------------------------------------------
 * The defining rule: the OS can USE secrets without EXPOSING them. Apps and
 * the AI address secrets by reference — secret://provider/name — and request
 * brokered use; raw values are only shown on an explicit, audited user action.
 *
 * Values are encrypted at rest with WebCrypto: PBKDF2 (SHA-256, 600k
 * iterations, random salt) derives a non-extractable AES-GCM key from the
 * user's passphrase; every value gets a random IV. The key lives only in module
 * memory while the vault is unlocked and auto-locks after idle. While locked,
 * reveal and brokered use fail with "vault locked" — there is no bypass.
 * Items stored by the pre-encryption build (plain base64) are migrated to
 * real encryption on the first unlock.
 */

import { storage, StoreKeys } from "../storage";
import { record, setAuditRedactor } from "../audit";
import { deliver, setNotificationRedactor } from "./notification";
import { mintDestructiveToken, consumeDestructiveToken } from "../objects";
import { registerExternalExecutor, type ExecutorOutcome } from "../broker";
import type { ActionProposal } from "@/types";

export type SecretCategory = "password" | "api-key" | "token" | "passkey" | "note";

export interface SecretItem {
  id: string;
  /** secret://provider/name — how apps and the AI address it. */
  ref: string;
  label: string;
  category: SecretCategory;
  /** Encrypted value: "enc1:<iv>:<ciphertext>". Legacy items are plain base64
      until the first unlock migrates them. */
  value: string;
  /** Length of the raw value, so masks render without decrypting. */
  valueLength?: number;
  /** "brokered": the AI may request use; it never sees the raw value. */
  aiAccess: "none" | "brokered";
  createdAt: number;
  lastUsedAt?: number;
}

let seq = 0;
function makeId(): string {
  seq += 1;
  return `sec-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/*
 * Reads go straight through storage.get — its snapshot cache already returns
 * a stable reference until the raw value changes, and a module-level cache
 * here could go stale against cross-tab writes (the vault must always
 * evaluate the CURRENT persisted ciphertexts, or a rotation in another tab
 * is invisible to this one's policy checks).
 */
function load(): SecretItem[] {
  return storage.get<SecretItem[]>(StoreKeys.secretsItems, [], Array.isArray);
}

function save(next: SecretItem[]): void {
  storage.set(StoreKeys.secretsItems, next);
}

export function subscribeSecrets(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.secretsItems, fn);
}

/* ------------------------------ vault crypto -------------------------------- */

const PBKDF2_ITERATIONS = 600_000;
const IDLE_LOCK_MS = 15 * 60_000;
const VERIFIER_PLAINTEXT = "locus-vault-verifier-v1";
const ENC_PREFIX = "enc1:";
/** AAD-bound format (Wave 3): ciphertext is cryptographically bound to the
    secret's id via AES-GCM additional data, so one valid ciphertext record
    cannot be swapped under another secret's metadata and still decrypt. */
const ENC2_PREFIX = "enc2:";

interface VaultMeta {
  salt: string;
  verifier: string;
  iterations: number;
  createdAt: number;
}

/** The AES-GCM key, in module memory only while unlocked. Non-extractable. */
let vaultKey: CryptoKey | null = null;
/** Decrypted values while unlocked (id → raw) — powers masks, reveal, and
    vault-aware redaction. Cleared on lock. */
let plainCache: Map<string, string> | null = null;
/** The exact ciphertext each cached plaintext was decrypted from (id →
    stored value). Lets reveal detect a cross-tab rotation and refuse stale
    plaintext instead of returning an outdated value under current metadata. */
let plainCipherOf: Map<string, string> | null = null;
let idleTimer: number | null = null;

function b64(bytes: Uint8Array): string {
  let out = "";
  bytes.forEach((b) => (out += String.fromCharCode(b)));
  return btoa(out);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt. With `aad` (the secret id) the result is the AAD-bound enc2
    format; without, the legacy enc1 format (used only by the vault verifier). */
async function encryptValue(key: CryptoKey, raw: string, aad?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params: AesGcmParams = { name: "AES-GCM", iv: iv as BufferSource };
  if (aad) params.additionalData = new TextEncoder().encode(aad) as BufferSource;
  const ct = await crypto.subtle.encrypt(params, key, new TextEncoder().encode(raw));
  return `${aad ? ENC2_PREFIX : ENC_PREFIX}${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX) || stored.startsWith(ENC2_PREFIX);
}

/** Decrypt either format. enc2 REQUIRES the matching AAD — a ciphertext moved
    under a different secret id fails authentication instead of decrypting. */
async function decryptValue(key: CryptoKey, stored: string, aad?: string): Promise<string | null> {
  const bound = stored.startsWith(ENC2_PREFIX);
  if (!bound && !stored.startsWith(ENC_PREFIX)) return null;
  const [ivB64, dataB64] = stored.slice(ENC_PREFIX.length).split(":");
  if (!ivB64 || !dataB64) return null;
  try {
    const params: AesGcmParams = { name: "AES-GCM", iv: fromB64(ivB64) as BufferSource };
    if (bound) {
      if (!aad) return null;
      params.additionalData = new TextEncoder().encode(aad) as BufferSource;
    }
    const plain = await crypto.subtle.decrypt(params, key, fromB64(dataB64) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Decode a value written by the pre-encryption build (plain base64). Returns
    null on failure — the caller must NOT treat an undecodable legacy value as
    an empty string (that would encrypt "" over the original and destroy it). */
function decodeLegacy(stored: string): string | null {
  try {
    return decodeURIComponent(escape(atob(stored)));
  } catch {
    return null;
  }
}

function getVaultMeta(): VaultMeta | null {
  return storage.get<VaultMeta | null>(StoreKeys.secretsVaultMeta, null);
}

export type VaultState = "uninitialized" | "locked" | "unlocked";

export function vaultState(): VaultState {
  if (!getVaultMeta()) return "uninitialized";
  return vaultKey ? "unlocked" : "locked";
}

export function subscribeVault(fn: () => void): () => void {
  const u1 = storage.subscribe(StoreKeys.secretsVaultMeta, fn);
  vaultListeners.add(fn);
  return () => {
    u1();
    vaultListeners.delete(fn);
  };
}

const vaultListeners = new Set<() => void>();
function notifyVault(): void {
  vaultListeners.forEach((fn) => fn());
}

function armIdleLock(): void {
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => lockVault("idle"), IDLE_LOCK_MS);
}

/**
 * Migrate stored values forward. Requires unlocked. Two generations:
 * plain base64 (pre-encryption build) → encrypted, and enc1 (unbound AES-GCM)
 * → enc2 (AAD-bound to the secret id). Undecodable/undecryptable originals
 * are preserved as-is — never overwritten with an encryption of "".
 */
async function migrateLegacyItems(): Promise<void> {
  if (!vaultKey) return;
  const migrated = new Map<string, { value: string; raw: string }>();
  let skipped = 0;
  for (const item of load()) {
    if (item.value.startsWith(ENC2_PREFIX)) continue; // current format
    let raw: string | null;
    if (item.value.startsWith(ENC_PREFIX)) {
      raw = await decryptValue(vaultKey, item.value); // enc1, no AAD
    } else {
      raw = decodeLegacy(item.value); // pre-encryption base64
    }
    if (raw === null) {
      skipped += 1;
      record({
        type: "system.event",
        summary: `Secrets Core: item ${item.ref} could not be decoded — kept as-is, not migrated`,
      });
      continue;
    }
    migrated.set(item.id, { value: await encryptValue(vaultKey, raw, item.id), raw });
  }
  if (migrated.size === 0) return;
  save(
    load().map((s) => {
      const m = migrated.get(s.id);
      return m ? { ...s, value: m.value, valueLength: m.raw.length } : s;
    }),
  );
  for (const [id, m] of migrated) {
    plainCache?.set(id, m.raw);
    plainCipherOf?.set(id, m.value);
  }
  record({
    type: "system.event",
    summary: `Secrets Core: ${migrated.size} item${migrated.size === 1 ? "" : "s"} migrated to AAD-bound encrypted storage${skipped ? ` (${skipped} preserved undecoded)` : ""}`,
  });
}

/** First-time setup: choose the passphrase that encrypts the vault. */
export async function setupVault(passphrase: string): Promise<boolean> {
  if (getVaultMeta() || !passphrase) return false;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const meta: VaultMeta = {
    salt: b64(salt),
    verifier: await encryptValue(key, VERIFIER_PLAINTEXT),
    iterations: PBKDF2_ITERATIONS,
    createdAt: Date.now(),
  };
  storage.set(StoreKeys.secretsVaultMeta, meta);
  vaultKey = key;
  plainCache = new Map();
  plainCipherOf = new Map();
  await migrateLegacyItems();
  armIdleLock();
  record({
    type: "vault.unlocked",
    summary: "Secrets Core: vault initialized — values are encrypted at rest (AES-GCM)",
  });
  notifyVault();
  return true;
}

/** Unlock with the passphrase. Wrong passphrase returns false (audited). */
export async function unlockVault(passphrase: string): Promise<boolean> {
  const meta = getVaultMeta();
  if (!meta) return false;
  const key = await deriveKey(passphrase, fromB64(meta.salt), meta.iterations);
  const check = await decryptValue(key, meta.verifier);
  if (check !== VERIFIER_PLAINTEXT) {
    record({ type: "system.event", summary: "Secrets Core: failed vault unlock attempt" });
    return false;
  }
  vaultKey = key;
  plainCache = new Map();
  plainCipherOf = new Map();
  let undecryptable = 0;
  for (const item of load()) {
    if (isEncrypted(item.value)) {
      const raw = await decryptValue(key, item.value, item.id);
      if (raw !== null) {
        plainCache.set(item.id, raw);
        plainCipherOf.set(item.id, item.value);
      } else {
        undecryptable += 1;
      }
    }
  }
  await migrateLegacyItems();
  armIdleLock();
  // Partial unlock is reported, not silently absorbed — an item that fails to
  // decrypt (corrupt record, swapped ciphertext failing its AAD check) is a
  // fact the user must see.
  record({
    type: "vault.unlocked",
    summary: "Secrets Core: vault unlocked by the user",
    detail: undecryptable
      ? `${undecryptable} item${undecryptable === 1 ? "" : "s"} could not be decrypted (corrupt or tampered) and stay unreadable.`
      : undefined,
  });
  if (undecryptable > 0) {
    deliver({
      title: "Some vault items could not be decrypted",
      detail: `${undecryptable} item${undecryptable === 1 ? "" : "s"} failed decryption — the stored record may be corrupt or tampered with.`,
      source: "Vault",
      priority: "high",
    });
  }
  notifyVault();
  return true;
}

export function lockVault(reason: "user" | "idle" = "user"): void {
  if (!vaultKey) return;
  vaultKey = null;
  plainCache = null;
  plainCipherOf = null;
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = null;
  record({
    type: "vault.locked",
    summary: `Secrets Core: vault locked (${reason === "idle" ? "idle timeout" : "by the user"})`,
  });
  notifyVault();
}

/* ------------------------------- masks & CRUD ------------------------------- */

/** A masked stand-in safe to render anywhere. Never decrypts. */
export function maskSecret(item: SecretItem): string {
  const len =
    item.valueLength ?? (isEncrypted(item.value) ? undefined : decodeLegacy(item.value)?.length);
  return len ? `•••• · ${len} chars` : "••••";
}

export function listSecrets(): SecretItem[] {
  return load();
}

export function makeRef(provider: string, name: string): string {
  const clean = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return `secret://${clean(provider) || "local"}/${clean(name) || "default"}`;
}

/**
 * Add a secret. Requires the vault to be unlocked (values are never written
 * in the clear). Refs are unique: re-adding an existing ref replaces its
 * value, keeping the reference stable for everything that names it.
 */
export async function addSecret(input: {
  label: string;
  provider: string;
  name: string;
  category: SecretCategory;
  value: string;
}): Promise<SecretItem | null> {
  if (!vaultKey) return null;
  armIdleLock();
  const ref = makeRef(input.provider, input.name);
  const existing = load().find((s) => s.ref === ref);
  if (existing) {
    // Rotation keeps the id, so the AAD binding stays stable.
    const encrypted = await encryptValue(vaultKey, input.value, existing.id);
    const updated: SecretItem = {
      ...existing,
      label: input.label,
      category: input.category,
      value: encrypted,
      valueLength: input.value.length,
    };
    save(load().map((s) => (s.id === existing.id ? updated : s)));
    plainCache?.set(existing.id, input.value);
    plainCipherOf?.set(existing.id, encrypted);
    record({ type: "secret.added", summary: `Secrets Core: rotated value for ${ref}` });
    return updated;
  }
  const id = makeId();
  const encrypted = await encryptValue(vaultKey, input.value, id);
  const item: SecretItem = {
    id,
    ref,
    label: input.label,
    category: input.category,
    value: encrypted,
    valueLength: input.value.length,
    // AI access is opt-in per secret: nothing the user stores is available
    // for brokered use until they explicitly turn it on.
    aiAccess: "none",
    createdAt: Date.now(),
  };
  save([item, ...load()]);
  plainCache?.set(item.id, input.value);
  plainCipherOf?.set(item.id, encrypted);
  record({ type: "secret.added", summary: `Secrets Core: added ${item.ref} (${item.category})` });
  return item;
}

/* ------------------------- recoverable delete (trash) ----------------------- */

/** A trashed secret: the full encrypted item plus when it was deleted. */
export interface TrashedSecret extends SecretItem {
  deletedAt: number;
}

const SECRET_TRASH_LIMIT = 50;

function loadTrash(): TrashedSecret[] {
  return storage.get<TrashedSecret[]>(StoreKeys.secretsTrash, [], Array.isArray);
}
function saveTrash(next: TrashedSecret[]): void {
  storage.set(StoreKeys.secretsTrash, next.slice(0, SECRET_TRASH_LIMIT));
}

export function listSecretTrash(): TrashedSecret[] {
  return loadTrash();
}

export function subscribeSecretTrash(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.secretsTrash, fn);
}

/**
 * Recoverable delete (Wave 3): the item moves to an ENCRYPTED trash — the
 * ciphertext travels with it, still AAD-bound to its id — instead of being
 * destroyed in one call. Restore brings it back; permanent purge requires a
 * confirmation token.
 */
export function removeSecret(id: string): void {
  const item = load().find((s) => s.id === id);
  if (!item) return;
  save(load().filter((s) => s.id !== id));
  saveTrash([{ ...item, deletedAt: Date.now() }, ...loadTrash()]);
  plainCache?.delete(id);
  plainCipherOf?.delete(id);
  record({
    type: "secret.removed",
    summary: `Secrets Core: removed ${item.ref} (recoverable — in the vault trash)`,
  });
}

/** Restore a trashed secret. Refuses if its ref was re-created meanwhile. */
export function restoreSecret(id: string): SecretItem | null {
  const trashed = loadTrash().find((s) => s.id === id);
  if (!trashed) return null;
  if (load().some((s) => s.ref === trashed.ref)) {
    record({
      type: "system.event",
      summary: `Secrets Core: restore refused — ${trashed.ref} exists again; rotate or remove it first`,
    });
    return null;
  }
  const { deletedAt: _dropped, ...item } = trashed;
  save([item, ...load()]);
  saveTrash(loadTrash().filter((s) => s.id !== id));
  record({ type: "secret.added", summary: `Secrets Core: restored ${item.ref} from the vault trash` });
  return item;
}

/** Step 1 of emptying the vault trash: mint the confirmation token. */
export function requestSecretTrashPurge(): { token: string; count: number } {
  return { token: mintDestructiveToken("secrets.trash"), count: loadTrash().length };
}

/** Step 2: permanently destroy the trashed ciphertexts (token-gated). */
export function purgeSecretTrash(token: string): number {
  if (!consumeDestructiveToken("secrets.trash", token)) {
    record({
      type: "system.event",
      summary: "Secrets Core: vault-trash purge refused — missing or expired confirmation token",
    });
    return 0;
  }
  const trashed = loadTrash();
  saveTrash([]);
  if (trashed.length > 0) {
    record({
      type: "secret.removed",
      summary: `Secrets Core: vault trash emptied (${trashed.length} item${trashed.length === 1 ? "" : "s"} permanently destroyed)`,
      detail: `Destroyed refs: ${trashed.map((s) => s.ref).join(", ").slice(0, 400)}`,
    });
  }
  return trashed.length;
}

export function setSecretAIAccess(id: string, access: SecretItem["aiAccess"]): void {
  const item = load().find((s) => s.id === id);
  if (!item || item.aiAccess === access) return;
  save(load().map((s) => (s.id === id ? { ...s, aiAccess: access } : s)));
  record({
    type: "secret.access_changed",
    summary: `Secrets Core: AI access for ${item.ref} set to ${access === "brokered" ? "brokered use" : "none"}`,
  });
}

/* ------------------------------ brokered access ---------------------------- */

/*
 * The REAL brokered-use path (Wave 3): public use is a typed `secrets.use`
 * proposal through AI Core → Security gate → Broker. Only the internal
 * executor (registered by initSecretsCore) ever receives the decrypted value,
 * and it hands it — short-lived, in memory, never persisted or returned to
 * the caller — to a registered consumer. No consumer is registered in this
 * no-provider build, so an approved use fails honestly instead of recording
 * a success that never delivered anything (the old placeholder's lie).
 */

export type SecretConsumer = (value: string, ctx: { ref: string; purpose: string }) => void;
const secretConsumers = new Map<string, SecretConsumer>();

/**
 * Register the runtime that actually consumes a brokered value (a provider
 * adapter, a scoped env injector). Once-only per name — a later module cannot
 * silently replace a consumer and receive values meant for another.
 */
export function registerSecretConsumer(name: string, fn: SecretConsumer): () => void {
  if (secretConsumers.has(name)) {
    console.warn(`[locus:secrets] consumer "${name}" is already registered; keeping the original`);
    return () => undefined;
  }
  secretConsumers.set(name, fn);
  return () => {
    if (secretConsumers.get(name) === fn) secretConsumers.delete(name);
  };
}

/**
 * Ask to USE a secret: creates a `secrets.use` proposal naming the ref, the
 * purpose, and the registered consumer that should receive the value on
 * approval. The requester never sees the value — approval hands it to the
 * consumer inside the executor, once.
 */
export async function requestSecretUse(input: {
  ref: string;
  purpose: string;
  consumer: string;
}): Promise<ActionProposal | null> {
  const item = load().find((s) => s.ref === input.ref);
  if (!item) return null;
  // Dynamic import on purpose: secrets.ts registers the audit/notification
  // redactors at module top level and is loaded very early, while ai.ts pulls
  // in aiContext → secrets. Importing ai() lazily here (only when a use is
  // actually requested) keeps that cycle out of module initialization.
  const { proposeThroughCore } = await import("./ai");
  return proposeThroughCore("secrets", {
    app: "vault",
    actionType: "secrets.use",
    summary: `Use ${input.ref} for: ${input.purpose}`,
    detail: `The raw value is delivered once to the “${input.consumer}” consumer; it is never shown or stored.`,
    effect: {
      kind: "external",
      externalSummary: `Brokered one-time use of ${input.ref}`,
      readOnly: false,
      payload: { title: input.ref },
      input: { ref: input.ref, purpose: input.purpose, consumer: input.consumer },
    },
  });
}

let secretsStarted = false;

/** Boot: register the internal executor that fulfills approved secrets.use
    proposals — the only code path that ever touches a decrypted value. */
export function initSecretsCore(): void {
  if (secretsStarted) return;
  secretsStarted = true;
  registerExternalExecutor("secrets.use", async (proposal): Promise<ExecutorOutcome> => {
    const input = proposal.effect.input ?? {};
    const ref = typeof input.ref === "string" ? input.ref : "";
    const purpose = typeof input.purpose === "string" ? input.purpose : proposal.summary;
    const consumerName = typeof input.consumer === "string" ? input.consumer : "";
    const item = load().find((s) => s.ref === ref);
    if (!item) return { status: "failed", detail: `No secret exists for ${ref}.` };
    if (item.aiAccess !== "brokered") {
      record({
        type: "secret.use_denied",
        summary: `Secrets Core: DENIED brokered use of ${ref} (AI access is off)`,
        detail: purpose,
      });
      deliver({
        title: "Secret use denied",
        detail: `An approved action asked to use ${ref} — AI access for it is off.`,
        source: "Vault",
        priority: "critical",
      });
      return { status: "failed", detail: `AI access for ${ref} is off.` };
    }
    if (!vaultKey) {
      record({
        type: "secret.use_denied",
        summary: `Secrets Core: brokered use of ${ref} failed — vault locked`,
        detail: `Purpose: ${purpose}. Unlock the vault to allow use.`,
      });
      return { status: "failed", detail: "The vault is locked — unlock it and re-approve." };
    }
    const consumer = secretConsumers.get(consumerName);
    if (!consumer) {
      return {
        status: "failed",
        detail: `No consumer runtime named “${consumerName}” is registered in this build — nothing received the value.`,
      };
    }
    // Decrypt on demand, bound to the stored ciphertext (never a stale cache
    // value under rotated metadata).
    const value = await decryptValue(vaultKey, item.value, item.id);
    if (value === null) {
      return { status: "failed", detail: `${ref} could not be decrypted (corrupt or tampered).` };
    }
    try {
      consumer(value, { ref, purpose });
    } catch (err) {
      return {
        status: "failed",
        detail: `The consumer failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    armIdleLock();
    save(load().map((s) => (s.id === item.id ? { ...s, lastUsedAt: Date.now() } : s)));
    record({
      type: "secret.used",
      summary: `Secrets Core: brokered use of ${ref} delivered to “${consumerName}”`,
      detail: `Purpose: ${purpose}. The raw value was not exposed or stored.`,
    });
    return { status: "succeeded", detail: `Used once by “${consumerName}” — value never shown.` };
  });
}

/**
 * The one existence question the AI may ask: does a reference exist? It can
 * plan around `secret://openai/default` being present without ever seeing
 * what it holds.
 */
export function secretRefExists(ref: string): boolean {
  return load().some((s) => s.ref === ref);
}

/**
 * What the AI may see of the vault: references and categories only — enough
 * to propose credential setup or brokered use, never a value or a mask.
 */
export function listRefsForAI(): { ref: string; category: SecretCategory; aiAccess: SecretItem["aiAccess"] }[] {
  return load().map((s) => ({ ref: s.ref, category: s.category, aiAccess: s.aiAccess }));
}

/**
 * Reveal is an explicit, audited USER action — never available to the AI,
 * and impossible while the vault is locked (returns null).
 */
export function revealSecret(id: string): string | null {
  const item = load().find((s) => s.id === id);
  if (!item) return null;
  if (!plainCache) return null;
  const raw = plainCache.get(id);
  if (raw === undefined) return null;
  // Cross-tab safety: if the stored ciphertext no longer matches what this
  // plaintext was decrypted from, the secret was rotated (or replaced) in
  // another tab — refuse rather than reveal a stale value under new metadata.
  if (plainCipherOf?.get(id) !== item.value) {
    plainCache.delete(id);
    plainCipherOf?.delete(id);
    return null;
  }
  armIdleLock();
  record({ type: "secret.revealed", summary: `Secrets Core: ${item.ref} revealed by the user` });
  return raw;
}

/* ------------------------------ leak detection ------------------------------ */

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Stripe key", re: /\b[sprk]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { name: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { name: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "AWS secret key", re: /\baws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}\b/gi },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "Connection-string password", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:[^\s@/]+@/g },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*\b/g },
];

export interface SecretFinding {
  name: string;
  match: string;
}

/** Scan text for likely raw secrets (directive: secret leak detection). */
export function detectSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      findings.push({ name, match: m[0].length > 12 ? `${m[0].slice(0, 8)}…` : m[0] });
    }
  }
  return findings;
}

/**
 * Redact likely secrets from text before it reaches search, AI context,
 * notifications, proposals, or export. Pattern-based always; additionally
 * vault-aware while unlocked — the user's own stored values are caught even
 * when no pattern matches them.
 */
export function redactText(text: string): string {
  let out = text;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, `[redacted: ${name}]`);
  }
  if (plainCache) {
    for (const raw of plainCache.values()) {
      if (raw.length >= 6 && out.includes(raw)) {
        out = out.split(raw).join("[redacted: vault value]");
      }
    }
  }
  return out;
}

// Every audit row and notification passes through redaction (F5). Registered
// here — not imported by audit/notification — because Secrets Core records
// and delivers itself, and a direct import would be a module cycle.
setAuditRedactor(redactText);
setNotificationRedactor(redactText);
