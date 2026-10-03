/*
 * Vault — the user-facing surface over Secrets Core (directive §14).
 * Values are encrypted at rest (WebCrypto AES-GCM behind a passphrase); the
 * vault locks itself after idle and everything sensitive fails closed while
 * locked. Secrets are addressed by reference (secret://provider/name),
 * masked by default, revealed only on explicit click (audited), and offered
 * to the AI only as brokered use — the AI can ask that a secret be used,
 * never see it. Includes the leak detector: paste text, see what should
 * never leave the device (vault-aware while unlocked).
 */

import { useState, useSyncExternalStore } from "react";
import {
  listSecrets,
  subscribeSecrets,
  subscribeVault,
  vaultState,
  setupVault,
  unlockVault,
  lockVault,
  addSecret,
  removeSecret,
  revealSecret,
  maskSecret,
  setSecretAIAccess,
  requestSecretUse,
  listSecretTrash,
  subscribeSecretTrash,
  restoreSecret,
  requestSecretTrashPurge,
  purgeSecretTrash,
  detectSecrets,
  type SecretCategory,
} from "@/core/cores/secrets";
import { formatDateTime } from "@/core/cores/time";
import { Section, FutureNote, EmptyState } from "@/components/ui";
import "./vault.css";

const CATEGORIES: SecretCategory[] = ["password", "api-key", "token", "passkey", "note"];

function VaultGate() {
  const state = vaultState();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (state === "uninitialized") {
      if (passphrase.length < 8) {
        setError("Use at least 8 characters — this passphrase encrypts everything.");
        return;
      }
      if (passphrase !== confirm) {
        setError("The passphrases do not match.");
        return;
      }
      setBusy(true);
      await setupVault(passphrase);
      setBusy(false);
    } else {
      setBusy(true);
      const ok = await unlockVault(passphrase);
      setBusy(false);
      if (!ok) setError("Wrong passphrase.");
    }
    setPassphrase("");
    setConfirm("");
  }

  return (
    <form className="vault__gate panel" onSubmit={submit}>
      <p className="vault__gatehead">
        {state === "uninitialized"
          ? "Set a vault passphrase — values are encrypted with it (PBKDF2 → AES-GCM) and it is never stored."
        : "The vault is locked. Reveal and brokered use are unavailable until you unlock it."}
      </p>
      <div className="vault__gaterow">
        <input
          className="field vault__grow"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder={state === "uninitialized" ? "Choose a passphrase" : "Passphrase"}
          aria-label="Vault passphrase"
          autoComplete="off"
        />
        {state === "uninitialized" && (
          <input
            className="field vault__grow"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passphrase"
            aria-label="Confirm passphrase"
            autoComplete="off"
          />
        )}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? "Working…" : state === "uninitialized" ? "Create vault" : "Unlock"}
        </button>
      </div>
      {error && <p className="vault__error mono">{error}</p>}
    </form>
  );
}

export default function Vault() {
  useSyncExternalStore(subscribeSecrets, listSecrets);
  useSyncExternalStore(subscribeSecretTrash, listSecretTrash);
  const trashedSecrets = listSecretTrash();
  const [trashPurgeToken, setTrashPurgeToken] = useState<string | null>(null);
  // vaultState() is a primitive snapshot; subscribeVault fires on lock/unlock.
  const state = useSyncExternalStore(subscribeVault, vaultState);
  const secrets = listSecrets();
  const unlocked = state === "unlocked";

  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<SecretCategory>("api-key");
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [scanText, setScanText] = useState("");
  const [addError, setAddError] = useState("");

  const findings = scanText ? detectSecrets(scanText) : [];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !value) return;
    const item = await addSecret({
      label: label.trim(),
      provider,
      name: name || label,
      category,
      value,
    });
    if (!item) {
      setAddError("The vault must be unlocked to add secrets.");
      return;
    }
    setAddError("");
    setLabel("");
    setProvider("");
    setName("");
    setValue("");
  }

  return (
    <div className="vault">
      <p className="vault__rule">
        The OS can <strong>use</strong> secrets without <strong>exposing</strong> them. The AI may request
        brokered use of a reference — it never sees raw values, and every use or reveal is audited.
      </p>

      {!unlocked && <VaultGate />}
      {unlocked && (
        <div className="vault__lockbar">
          <span className="mono faint">Vault unlocked · auto-locks after 15 minutes idle</span>
          <button className="btn btn--sm" onClick={() => lockVault("user")}>Lock now</button>
        </div>
      )}

      <Section title="Secrets">
        {secrets.length === 0 ? (
          <EmptyState title="The vault is empty" hint="Add a secret below. It is addressed everywhere by its secret:// reference." />
        ) : (
          <ul className="vault__list">
            {secrets.map((s) => (
              <li key={s.id} className="vault__item">
                <div className="vault__main">
                  <span className="vault__label">{s.label}</span>
                  <span className="chip">{s.category}</span>
                  <code className="mono vault__ref">{s.ref}</code>
                </div>
                <div className="vault__valuerow">
                  <code className="mono vault__value">{revealed[s.id] ?? maskSecret(s)}</code>
                  {revealed[s.id] ? (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        setRevealed(({ [s.id]: _dropped, ...rest }) => rest)
                      }
                    >
                      Hide
                    </button>
                  ) : (
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={!unlocked}
                      title={
                        unlocked
                          ? "Revealing is an explicit user action and is written to the audit log"
                          : "Unlock the vault to reveal"
                      }
                      onClick={() => {
                        const raw = revealSecret(s.id);
                        if (raw !== null) setRevealed((r) => ({ ...r, [s.id]: raw }));
                      }}
                    >
                      Reveal
                    </button>
                  )}
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={!unlocked}
                    onClick={() =>
                      void requestSecretUse({
                        ref: s.ref,
                        purpose: "demonstration from Vault",
                        consumer: "demo",
                      })
                    }
                    title={
                      unlocked
                        ? "Creates a secrets.use proposal — on approval, only a registered consumer receives the value, once"
                        : "Unlock the vault to use"
                    }
                  >
                    Use (brokered)
                  </button>
                  <label className="vault__ai">
                    <input
                      type="checkbox"
                      checked={s.aiAccess === "brokered"}
                      onChange={(e) => setSecretAIAccess(s.id, e.target.checked ? "brokered" : "none")}
                    />
                    AI may request use
                  </label>
                  <button
                    className="vault__x"
                    onClick={() => removeSecret(s.id)}
                    aria-label={`Remove ${s.label}`}
                    title="Moves to the vault trash (recoverable)"
                  >✕</button>
                </div>
                {s.lastUsedAt && (
                  <span className="mono faint vault__used">last used {formatDateTime(s.lastUsedAt)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {trashedSecrets.length > 0 && (
        <Section
          title={`Vault trash · ${trashedSecrets.length}`}
          action={
            <button
              className={`btn btn--sm ${trashPurgeToken ? "btn--primary" : "btn--ghost"}`}
              onClick={() => {
                if (!trashPurgeToken) {
                  setTrashPurgeToken(requestSecretTrashPurge().token);
                  return;
                }
                purgeSecretTrash(trashPurgeToken);
                setTrashPurgeToken(null);
              }}
              title="Permanent destruction requires this second confirming click (Core-level token)"
            >
              {trashPurgeToken ? "Confirm destroy" : "Destroy all…"}
            </button>
          }
        >
          <ul className="vault__list">
            {trashedSecrets.map((s2) => (
              <li key={s2.id} className="vault__row">
                <span className="mono">{s2.ref}</span>
                <span className="faint">removed {formatDateTime(s2.deletedAt)}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => restoreSecret(s2.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Add a secret">
        <form className="vault__add" onSubmit={add}>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. OpenAI default)" aria-label="Label" />
          <input className="field" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider (openai)" aria-label="Provider" />
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (default)" aria-label="Name" />
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value as SecretCategory)} aria-label="Category">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input className="field vault__grow" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Secret value" aria-label="Secret value" />
          <button className="btn btn--primary" type="submit" disabled={!unlocked}>Add</button>
        </form>
        {addError && <p className="vault__error mono">{addError}</p>}
        <p className="faint vault__honesty">
          {unlocked
            ? "Values are encrypted at rest (AES-GCM, per-value IV); the key never leaves memory and is dropped on lock."
            : "Adding requires the vault to be unlocked — nothing is ever written in the clear."}
        </p>
      </Section>

      <Section title="Leak detector">
        <textarea
          className="field vault__scan"
          value={scanText}
          onChange={(e) => setScanText(e.target.value)}
          placeholder="Paste text (a commit, a doc, a config) to scan for raw secrets before it goes anywhere…"
          aria-label="Text to scan"
        />
        {scanText && (
          <p className={findings.length ? "vault__findings vault__findings--bad" : "vault__findings"}>
            {findings.length === 0
              ? "No likely secrets found."
              : `${findings.length} likely secret${findings.length === 1 ? "" : "s"}: ${findings.map((f) => `${f.name} (${f.match})`).join(", ")} — Search, proposals, notifications, and AI context redact these automatically.`}
          </p>
        )}
      </Section>

      <Section title="About this app">
        <FutureNote
          items={[
            "Passkeys and recovery codes",
            "Rotation reminders via Time Core; unusual-use alerts via Monitor Core",
            "Scoped env injection into Dev Core sandbox runs",
            "Off-device broker integration",
          ]}
        />
      </Section>
    </div>
  );
}
