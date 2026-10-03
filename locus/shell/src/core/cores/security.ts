/*
 * Security Core — the policy authority (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Focus: permissions, trust levels, risk classification, sandbox policy,
 * approval rules, app install safety, trusted actions, and capability
 * enforcement. Secrets Core handles credentials; Security Core decides what
 * apps, Cores, and AI may do: the five capability tiers (core/permissions),
 * trusted actions (core/broker), risk classification for approval prompts,
 * and — for Dev Core's generated software — the sandbox policy and the
 * capability-manifest check that makes dangerous escalation explicit.
 *
 * This Core is consulted at runtime, not just displayed: the AI Broker calls
 * authorizeProposal() on every propose/approve/execute (shared foundation
 * F3), refuses what policy forbids, stores the risk classification and undo
 * note on the proposal, and lets trusted actions auto-run only the effect
 * kinds they explicitly cover.
 */

import { record } from "../audit";
import { emit } from "../events";
import { effectiveCapabilities } from "../permissions";
import { getTrustedActions, setTrustedEnabled } from "../broker";
import { getObject } from "../objects";
import {
  getActionDefinition,
  listActionDefinitions,
  type ActionDefinition,
  type RiskLevel,
} from "../actionRegistry";
import type { ActionProposal, AICapabilities, AppId, EffectKind, ProposalEffect } from "@/types";
import { CORES, type CoreId } from "./registry";

export { effectiveCapabilities, getTrustedActions, setTrustedEnabled };
export { getActionDefinition, listActionDefinitions, type ActionDefinition, type RiskLevel };

/** Classify a proposal effect so prompts can say how much is at stake. */
export function classifyRisk(effect: ProposalEffect): RiskLevel {
  if (effect.kind === "delete") return "dangerous";
  if (effect.kind === "external") return effect.readOnly ? "safe" : "dangerous";
  return "caution";
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  safe: "Safe — read-only",
  caution: "Caution — changes local data (undoable, audited)",
  dangerous: "Dangerous — deletes data or leaves the device",
};

/* --------------------------- proposal authorization -------------------------- */

/**
 * Action types the AI may never take, regardless of tier or trusted actions.
 * The vault reveal path and the audit spine are user-only by construction.
 */
const FORBIDDEN_ACTION_TYPES: { re: RegExp; reason: string }[] = [
  { re: /^secrets\.reveal/i, reason: "Revealing raw secret values is a user-only action" },
  { re: /^audit\.(clear|archive|edit)/i, reason: "The audit record cannot be altered by the AI" },
  { re: /^security\.(bypass|disable)/i, reason: "Security policy cannot disable itself" },
];

export type AuthorizationVerdict =
  | { allowed: true; risk: RiskLevel; undoNote: string }
  | { allowed: false; reason: string };

/** The plain-language undo note stored on the proposal and shown at approval. */
export function undoNoteFor(effect: ProposalEffect): string {
  switch (effect.kind) {
    case "create":
      return "Undo deletes the created object.";
    case "update":
      return "Undo restores the previous values (a snapshot is kept at execution).";
    case "delete":
      return "Undo recreates the object from the snapshot kept at execution.";
    case "external":
      return effect.readOnly
        ? "A read grant — revoke it in the grants list; nothing local changes."
        : "External effects cannot be undone from here — review before approving.";
  }
}

/** Does this effect write (locally or externally), as opposed to reading? */
function isWriteEffect(effect: ProposalEffect): boolean {
  if (effect.kind === "external") return !effect.readOnly;
  return true; // create / update / delete all write
}

/**
 * The broker's gate (F3): consulted at propose, and again at approve and
 * execute so a verdict can never go stale against changed policy.
 *
 * Enforcement is structural and **fail closed**, driven by the typed Action
 * Definition registry (core/actionRegistry): an actionType with no
 * definition, a proposing app the definition does not name, a mismatched
 * effect kind, an undeclared object/target type, a payload field outside the
 * definition's allowlist, executor input the definition does not accept, or a
 * caller-asserted readOnly flag that disagrees with the definition — all
 * deny. On top of the structural contract, the definition's governing
 * capability labels must sit in a permitted tier of the app's *effective*
 * capabilities (manifest merged with Control Center overrides): forbidden
 * refuses outright; writes need writableWithApproval/trusted; a read-only
 * external is satisfied by any non-forbidden tier placement.
 *
 * Returns the definition's risk + undo note, which the proposal carries from
 * then on. The broker passes `capabilities` as a parameter rather than a
 * lookup here so this module never imports the app registry (which imports
 * the app surfaces, which import the Cores).
 */
export function authorizeProposal(input: {
  app: AppId;
  actionType: string;
  effect: ProposalEffect;
  capabilities?: AICapabilities;
}): AuthorizationVerdict {
  const { actionType, effect, capabilities } = input;

  for (const rule of FORBIDDEN_ACTION_TYPES) {
    if (rule.re.test(actionType)) return { allowed: false, reason: rule.reason };
  }
  if (effect.kind === "create" && !effect.objectType) {
    return { allowed: false, reason: "A create effect must declare its objectType" };
  }
  if ((effect.kind === "update" || effect.kind === "delete") && !effect.targetId) {
    return { allowed: false, reason: `An ${effect.kind} effect must name its target object` };
  }
  if (effect.kind === "external" && !effect.externalSummary) {
    return { allowed: false, reason: "An external effect must describe the outside action" };
  }

  // --- Fail-closed manifest requirement ---
  // Every effect kind writes locally or leaves the device (a read-only
  // external is still egress), so every proposal must be backed by a
  // capability manifest Security can evaluate. A missing manifest means the
  // proposing app is unknown or unregistered — deny by default.
  if (!capabilities) {
    return {
      allowed: false,
      reason: "This app has no capability manifest Security can enforce — denied by default",
    };
  }

  // --- Structural contract (Action Definition registry) ---
  const def = getActionDefinition(actionType);
  if (!def) {
    return {
      allowed: false,
      reason: `Unknown action “${actionType}” — no Action Definition is registered (denied by default)`,
    };
  }
  if (!def.apps.includes(input.app)) {
    return {
      allowed: false,
      reason: `“${actionType}” belongs to ${def.apps.join("/")} — ${input.app} cannot propose it`,
    };
  }
  if (effect.kind !== def.effectKind) {
    return {
      allowed: false,
      reason: `“${actionType}” is a ${def.effectKind} action — a ${effect.kind} effect does not match its definition`,
    };
  }
  if (effect.kind === "create" && def.objectTypes && effect.objectType &&
      !def.objectTypes.includes(effect.objectType)) {
    return {
      allowed: false,
      reason: `“${actionType}” may only create ${def.objectTypes.join("/")} objects, not ${effect.objectType}`,
    };
  }
  if ((effect.kind === "update" || effect.kind === "delete") && effect.targetId && def.targetTypes) {
    const target = getObject(effect.targetId);
    if (target && !def.targetTypes.includes(target.type)) {
      return {
        allowed: false,
        reason: `“${actionType}” may only touch ${def.targetTypes.join("/")} objects — the target is a ${target.type}`,
      };
    }
  }
  if (effect.kind === "external") {
    const declaredReadOnly = effect.readOnly ?? false;
    if (declaredReadOnly !== def.external!.readOnly) {
      return {
        allowed: false,
        reason: `“${actionType}” is defined as ${def.external!.readOnly ? "read-only" : "a writing external action"} — the effect's readOnly flag disagrees`,
      };
    }
    if (effect.input && !def.external?.acceptsInput) {
      return { allowed: false, reason: `“${actionType}” does not accept structured executor input` };
    }
  } else if (effect.input) {
    return { allowed: false, reason: "Executor input is only valid on external effects" };
  }
  const allowedFields = new Set<string>(def.allowedFields ?? []);
  const extraFields = Object.keys(effect.payload ?? {}).filter((k) => !allowedFields.has(k));
  if (extraFields.length > 0) {
    return {
      allowed: false,
      reason: `“${actionType}” may not write field${extraFields.length === 1 ? "" : "s"}: ${extraFields.join(", ")}`,
    };
  }

  // --- Capability-tier enforcement over the definition's governing labels ---
  const write = isWriteEffect(effect);
  const governingLabels = def.labels[input.app];
  if (!governingLabels || governingLabels.length === 0) {
    return {
      allowed: false,
      reason: `“${actionType}” declares no governing capability label for ${input.app} — denied by default`,
    };
  }
  const forbiddenLabel = governingLabels.find((label) => capabilities.forbidden.includes(label));
  if (forbiddenLabel) {
    return { allowed: false, reason: `Forbidden for this app: “${forbiddenLabel}”` };
  }
  const inWriteTier = governingLabels.some(
    (label) =>
      capabilities.writableWithApproval.includes(label) || capabilities.trusted.includes(label),
  );
  // A read-only external effect (a scoped read grant) is permitted by any
  // non-forbidden tier placement; a write requires a writable tier.
  const inReadTier =
    !write &&
    governingLabels.some(
      (label) =>
        capabilities.readable.includes(label) || capabilities.suggestible.includes(label),
    );
  if (!inWriteTier && !inReadTier) {
    return {
      allowed: false,
      reason: `The user has moved “${governingLabels[0]}” out of this app's permitted tiers`,
    };
  }

  return { allowed: true, risk: def.risk, undoNote: def.undoNote };
}

/**
 * May this trusted action auto-run this effect? Scope is checked, not just
 * (app, actionType): deletes and external effects never auto-run unless the
 * trusted action explicitly lists them in effectKinds.
 */
export function trustedActionCovers(
  trusted: { effectKinds?: EffectKind[] },
  effect: ProposalEffect,
): boolean {
  const covered = trusted.effectKinds ?? ["create", "update"];
  return covered.includes(effect.kind);
}

/**
 * Does the app's effective policy actually place this action's governing
 * capability in the `trusted` tier? A Trusted Action only *auto-runs* when the
 * capability itself is trusted — otherwise the two trust surfaces could
 * disagree (an enabled Trusted Action silently auto-running a capability the
 * user left in Writable-with-approval). Moving the label out of `trusted`
 * drops auto-run back to per-approval.
 *
 * An actionType with no Action Definition (or no governing label for this
 * app) has no capability to verify as trusted, so auto-run is denied on tier
 * grounds (fail closed): such actions still require an explicit approval even
 * with a Trusted Action enabled.
 */
export function trustedTierPermits(input: {
  app: AppId;
  actionType: string;
  capabilities?: AICapabilities;
}): boolean {
  const labels = getActionDefinition(input.actionType)?.labels[input.app];
  if (!labels || !input.capabilities) return false;
  return labels.some((label) => input.capabilities!.trusted.includes(label));
}

/** The approval prompt format (directive: approval prompt format). */
export interface ApprovalPrompt {
  title: string;
  summary: string;
  risk: RiskLevel;
  riskLabel: string;
  dataTouched: string;
  undoNote: string;
}

/** Render the approval prompt for a proposal — risk, data touched, undo. */
export function buildApprovalPrompt(p: ActionProposal): ApprovalPrompt {
  const risk = p.risk ?? classifyRisk(p.effect);
  const dataTouched =
    p.effect.kind === "external"
      ? p.effect.externalSummary ?? "An external surface"
      : `${p.effect.objectType ?? "object"}${p.effect.targetId ? ` ${p.effect.targetId}` : ""}${
          p.effect.payload
            ? ` — fields: ${Object.keys(p.effect.payload).join(", ") || "none"}`
            : ""
        }`;
  return {
    title: `${p.actionType} (${p.app})`,
    summary: p.summary,
    risk,
    riskLabel: RISK_LABELS[risk],
    dataTouched,
    undoNote: p.undoNote ?? undoNoteFor(p.effect),
  };
}

/* ------------------------- sandbox policy (Dev Core) ------------------------ */

/**
 * The policy generated software runs under. Dev Core validates artifacts
 * against it; this Core owns what the rules *are*, so the boundary between
 * "what code wants" and "what the OS allows" stays in one place.
 */
export const SANDBOX_POLICY = {
  /** Dependencies generated code may declare. Everything else needs review. */
  dependencyAllowlist: ["react", "react-dom"],
  /** Globals generated code must not reach for — the Cores are the API.
      Advisory: the static scan warns, the sandbox CSP enforces at runtime. */
  forbiddenGlobals: [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "eval",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "document.cookie",
    "importScripts",
  ],
  /** Network access is deny-by-default for generated artifacts. */
  networkDefault: "deny" as const,
  /** Raw secret values are never available inside a sandbox. */
  secretAccess: "reference-only" as const,
  /** Source cap keeps generated artifacts reviewable. */
  maxArtifactBytes: 64_000,
};

/**
 * The canonical permission vocabulary a manifest may request: a Core id, a
 * dot, and an operation. Free-text like "everything" fails evaluation.
 */
export const PERMISSION_OPERATIONS = ["read", "write", "delete", "reference"] as const;
export type PermissionOperation = (typeof PERMISSION_OPERATIONS)[number];

const CORE_IDS = new Set<string>(CORES.map((c) => c.id));

export function isCanonicalPermission(perm: string): boolean {
  const [core, op, extra] = perm.split(".");
  return !extra && CORE_IDS.has(core as CoreId) && PERMISSION_OPERATIONS.includes(op as PermissionOperation);
}

/** The capability manifest a generated artifact declares. */
export interface CapabilityManifest {
  /** Core-level permissions requested, e.g. "cardspoke.read", "time.read". */
  permissions: string[];
  dependencies: string[];
  network: boolean;
}

export interface ManifestVerdict {
  allowed: boolean;
  /** Hard violations: the artifact cannot run as declared. */
  violations: string[];
  /** Soft findings the approval prompt should surface. */
  requiresApproval: string[];
}

/** Permission strings that always require an explicit approval to grant. */
const WRITE_PERMISSION = /\.(write|delete)$/;

/**
 * Check a declared capability manifest against sandbox policy. Permissions
 * must use the canonical vocabulary (coreId.operation); read permissions are
 * grantable; write permissions require approval; network access and
 * non-allowlisted dependencies are violations until the user changes policy.
 */
export function evaluateManifest(manifest: CapabilityManifest): ManifestVerdict {
  const violations: string[] = [];
  const requiresApproval: string[] = [];

  for (const dep of manifest.dependencies) {
    if (!SANDBOX_POLICY.dependencyAllowlist.includes(dep)) {
      violations.push(`Dependency “${dep}” is not on the allowlist`);
    }
  }
  if (manifest.network && SANDBOX_POLICY.networkDefault === "deny") {
    violations.push("Requests network access (deny-by-default for generated code)");
  }
  for (const perm of manifest.permissions) {
    if (!isCanonicalPermission(perm)) {
      violations.push(
        `“${perm}” is not a recognized permission — use <core>.<read|write|delete|reference>`,
      );
    } else if (perm.startsWith("secrets.") && perm !== "secrets.reference") {
      violations.push(`“${perm}” — sandboxes get secret references only`);
    } else if (WRITE_PERMISSION.test(perm)) {
      requiresApproval.push(`“${perm}” writes through a Core — each use is proposal-gated`);
    }
  }

  const verdict: ManifestVerdict = {
    allowed: violations.length === 0,
    violations,
    requiresApproval,
  };
  record({
    type: "manifest.evaluated",
    summary: `Security Core: manifest ${verdict.allowed ? "within policy" : "REJECTED"} (${manifest.permissions.length} permission${manifest.permissions.length === 1 ? "" : "s"})`,
    detail: violations.length ? violations.join("; ") : requiresApproval.join("; ") || undefined,
  });
  emit("manifest.evaluated", { manifest, verdict });
  return verdict;
}
