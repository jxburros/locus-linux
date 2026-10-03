/*
 * The Credential Broker.
 * ---------------------------------------------------------------------------
 * External accounts, APIs, local services, and agent tools are mediated here.
 * The broker's whole point is that it exposes *capabilities* (scoped, named
 * operations) rather than raw secrets: the AI never sees a token, only a
 * grantable capability like "calendar.readEvents". Every grant/deny is logged.
 *
 * In this build no real secrets are stored — the broker models the decision
 * surface, so the trust boundary exists before any provider is wired in.
 */

import { storage, StoreKeys } from "./storage";
import { record } from "./audit";

export type CapabilityRisk = "read" | "write" | "sensitive";

export interface BrokeredCapability {
  id: string;
  label: string;
  risk: CapabilityRisk;
  /** Whether the AI layer may currently use this capability. */
  granted: boolean;
}

export interface CredentialConnection {
  id: string;
  name: string;
  service: string;
  /** Present only as a boolean — the secret itself never lives here. */
  hasSecret: boolean;
  capabilities: BrokeredCapability[];
}

// Stable-reference cache for useSyncExternalStore (see workspace.ts).
let cache: CredentialConnection[] | null = null;

function load(): CredentialConnection[] {
  if (cache) return cache;
  cache = storage.get<CredentialConnection[]>(StoreKeys.credentials, seed());
  return cache;
}
function save(list: CredentialConnection[]): void {
  cache = list;
  storage.set(StoreKeys.credentials, list);
}

export function getConnections(): CredentialConnection[] {
  return load();
}

export function setCapabilityGranted(
  connectionId: string,
  capabilityId: string,
  granted: boolean,
): void {
  let conn: CredentialConnection | undefined;
  let cap: BrokeredCapability | undefined;
  const next = load().map((c) => {
    if (c.id !== connectionId) return c;
    conn = c;
    return {
      ...c,
      capabilities: c.capabilities.map((k) => {
        if (k.id !== capabilityId) return k;
        cap = k;
        return { ...k, granted };
      }),
    };
  });
  save(next);
  if (conn && cap) {
    record({
      type: granted ? "credential.request_granted" : "credential.request_denied",
      summary: `${conn.name}: capability “${cap.label}” ${granted ? "granted" : "revoked"}`,
      detail: `Scoped ${cap.risk} capability. The underlying secret is never exposed to the AI.`,
    });
  }
}

export function subscribe(fn: () => void): () => void {
  return storage.subscribe(StoreKeys.credentials, () => {
    cache = null;
    fn();
  });
}

/** Default connections modelling the broker surface, all secrets withheld. */
function seed(): CredentialConnection[] {
  return [
    {
      id: "cal",
      name: "Calendar",
      service: "calendar",
      hasSecret: true,
      capabilities: [
        { id: "cal.read", label: "Read events", risk: "read", granted: true },
        { id: "cal.create", label: "Create events", risk: "write", granted: false },
        { id: "cal.delete", label: "Delete events", risk: "sensitive", granted: false },
      ],
    },
    {
      id: "mail",
      name: "Mail",
      service: "mail",
      hasSecret: true,
      capabilities: [
        { id: "mail.read", label: "Read messages", risk: "read", granted: false },
        { id: "mail.draft", label: "Draft replies", risk: "write", granted: false },
        { id: "mail.send", label: "Send mail", risk: "sensitive", granted: false },
      ],
    },
    {
      id: "shell",
      name: "Local tools",
      service: "agent-tools",
      hasSecret: false,
      capabilities: [
        { id: "tool.search", label: "Run local search", risk: "read", granted: true },
        { id: "tool.fs", label: "Read connected folders", risk: "read", granted: false },
      ],
    },
  ];
}
