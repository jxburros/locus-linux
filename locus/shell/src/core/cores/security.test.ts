import { beforeEach, describe, expect, it } from "vitest";
import { storage, StoreKeys } from "../storage";
import type { AICapabilities, ProposalEffect } from "@/types";
import {
  authorizeProposal,
  buildApprovalPrompt,
  classifyRisk,
  evaluateManifest,
  isCanonicalPermission,
  RISK_LABELS,
  SANDBOX_POLICY,
  trustedActionCovers,
  undoNoteFor,
} from "./security";

function caps(overrides: Partial<AICapabilities> = {}): AICapabilities {
  return {
    readable: [],
    suggestible: [],
    writableWithApproval: [],
    trusted: [],
    forbidden: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("classifyRisk", () => {
  it("treats delete as dangerous", () => {
    expect(classifyRisk({ kind: "delete", targetId: "x" })).toBe("dangerous");
  });

  it("treats a read-only external effect as safe", () => {
    expect(classifyRisk({ kind: "external", readOnly: true })).toBe("safe");
  });

  it("treats a writing external effect as dangerous", () => {
    expect(classifyRisk({ kind: "external", readOnly: false })).toBe("dangerous");
  });

  it("treats create/update as caution", () => {
    expect(classifyRisk({ kind: "create", objectType: "task" })).toBe("caution");
    expect(classifyRisk({ kind: "update", targetId: "x" })).toBe("caution");
  });
});

describe("undoNoteFor", () => {
  it("describes undo for every effect kind", () => {
    expect(undoNoteFor({ kind: "create", objectType: "task" })).toMatch(/deletes the created/i);
    expect(undoNoteFor({ kind: "update", targetId: "x" })).toMatch(/restores the previous/i);
    expect(undoNoteFor({ kind: "delete", targetId: "x" })).toMatch(/recreates the object/i);
    expect(undoNoteFor({ kind: "external", readOnly: true })).toMatch(/revoke it/i);
    expect(undoNoteFor({ kind: "external", readOnly: false })).toMatch(/cannot be undone/i);
  });
});

describe("authorizeProposal — shape validation", () => {
  it("refuses a create effect with no objectType", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create" } as ProposalEffect,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("refuses an update effect with no targetId", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.update",
      effect: { kind: "update" } as ProposalEffect,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("refuses a delete effect with no targetId", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.delete",
      effect: { kind: "delete" } as ProposalEffect,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("refuses an external effect with no externalSummary", () => {
    const verdict = authorizeProposal({
      app: "web",
      actionType: "web.openUrl",
      effect: { kind: "external" } as ProposalEffect,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("denies a write effect when no capability manifest is supplied (fail closed)", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "task" },
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/no capability manifest/i);
  });
});

describe("authorizeProposal — hard-forbidden action types", () => {
  it("always refuses secrets.reveal regardless of capabilities", () => {
    const verdict = authorizeProposal({
      app: "vault",
      actionType: "secrets.reveal",
      effect: { kind: "external", externalSummary: "reveal a secret", readOnly: true },
      capabilities: caps({ trusted: ["Reveal a secret"] }),
    });
    expect(verdict.allowed).toBe(false);
  });

  it("always refuses audit.clear / audit.edit", () => {
    for (const actionType of ["audit.clear", "audit.archive", "audit.edit"]) {
      const verdict = authorizeProposal({
        app: "assistant",
        actionType,
        effect: { kind: "delete", targetId: "x" },
        capabilities: caps({ trusted: ["anything"] }),
      });
      expect(verdict.allowed).toBe(false);
    }
  });

  it("always refuses security.bypass / security.disable", () => {
    const verdict = authorizeProposal({
      app: "assistant",
      actionType: "security.disable",
      effect: { kind: "update", targetId: "x" },
      capabilities: caps({ trusted: ["anything"] }),
    });
    expect(verdict.allowed).toBe(false);
  });
});

describe("authorizeProposal — per-label enforcement (Action Definition labels)", () => {
  it("allows tasks.create when its label is writableWithApproval", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "task" },
      capabilities: caps({ writableWithApproval: ["Create a task"] }),
    });
    expect(verdict.allowed).toBe(true);
  });

  it("refuses tasks.create when its label is forbidden, even if also elsewhere", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "task" },
      capabilities: caps({
        writableWithApproval: ["Create a task"],
        forbidden: ["Create a task"],
      }),
    });
    expect(verdict.allowed).toBe(false);
  });

  it("refuses tasks.create when its label sits in neither writable tier", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "task" },
      capabilities: caps({ readable: ["Create a task"] }),
    });
    expect(verdict.allowed).toBe(false);
  });

  it("allows a trusted label just as readily as a writableWithApproval one", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "task" },
      capabilities: caps({ trusted: ["Create a task"] }),
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe("authorizeProposal — structural default-deny (Action Definition registry)", () => {
  it("denies an actionType with no Action Definition, even with writable tiers", () => {
    const verdict = authorizeProposal({
      app: "projects",
      actionType: "projects.create",
      effect: { kind: "create", objectType: "project" },
      capabilities: caps({ writableWithApproval: ["Create a project"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/no action definition/i);
  });

  it("denies an unknown read-only external effect (no definition, no fallback)", () => {
    const verdict = authorizeProposal({
      app: "projects",
      actionType: "projects.peek",
      effect: { kind: "external", externalSummary: "peek", readOnly: true },
      capabilities: caps({ readable: ["Read projects"] }),
    });
    expect(verdict.allowed).toBe(false);
  });

  it("denies a defined action proposed by an app the definition does not name", () => {
    const verdict = authorizeProposal({
      app: "cards",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "task" },
      capabilities: caps({ writableWithApproval: ["Create a task"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/cannot propose/i);
  });

  it("denies a mismatched effect kind (a permitted create action carrying a delete)", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "delete", targetId: "x" },
      capabilities: caps({ writableWithApproval: ["Create a task"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/does not match/i);
  });

  it("denies a create effect whose objectType the definition does not allow", () => {
    const verdict = authorizeProposal({
      app: "tasks",
      actionType: "tasks.create",
      effect: { kind: "create", objectType: "document" },
      capabilities: caps({ writableWithApproval: ["Create a task"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/may only create/i);
  });

  it("denies a payload field the definition does not declare", () => {
    const verdict = authorizeProposal({
      app: "cards",
      actionType: "cards.create",
      effect: {
        kind: "create",
        objectType: "card",
        payload: { title: "ok", done: true },
      },
      capabilities: caps({ writableWithApproval: ["Create a card"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/may not write field/i);
  });

  it("denies a caller-asserted readOnly flag that disagrees with the definition", () => {
    // time.reminder is defined as a WRITING external action; asserting
    // readOnly must not weaken the check.
    const verdict = authorizeProposal({
      app: "time",
      actionType: "time.reminder",
      effect: { kind: "external", externalSummary: "schedule", readOnly: true },
      capabilities: caps({ writableWithApproval: ["Create a reminder"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/readonly flag disagrees/i);
  });

  it("denies executor input on an action whose definition does not accept it", () => {
    const verdict = authorizeProposal({
      app: "files",
      actionType: "files.access",
      effect: {
        kind: "external",
        externalSummary: "read a file",
        readOnly: true,
        targetId: "file-x",
        input: { sneak: "data" },
      },
      capabilities: caps({ readable: ["Connected file contents"] }),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/does not accept structured executor input/i);
  });

  it("allows a defined read-only external action via a readable-tier label", () => {
    const verdict = authorizeProposal({
      app: "files",
      actionType: "files.access",
      effect: {
        kind: "external",
        externalSummary: "read a file",
        readOnly: true,
        targetId: "file-x",
      },
      capabilities: caps({ readable: ["Connected file contents"] }),
    });
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      // Risk and undo come from the definition, not from generic effect rules.
      expect(verdict.risk).toBe("safe");
      expect(verdict.undoNote).toMatch(/revoke it in the grants list/i);
    }
  });

  it("returns the definition's risk for a writing external action (not generic 'dangerous')", () => {
    const verdict = authorizeProposal({
      app: "time",
      actionType: "time.reminder",
      effect: {
        kind: "external",
        externalSummary: "schedule a reminder",
        readOnly: false,
        payload: { title: "call" },
      },
      capabilities: caps({ writableWithApproval: ["Create a reminder"] }),
    });
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.risk).toBe("caution");
      expect(verdict.undoNote).toMatch(/cancelled or rescheduled/i);
    }
  });
});

describe("trustedActionCovers", () => {
  it("defaults to covering create/update only", () => {
    const trusted = {};
    expect(trustedActionCovers(trusted, { kind: "create", objectType: "task" })).toBe(true);
    expect(trustedActionCovers(trusted, { kind: "update", targetId: "x" })).toBe(true);
    expect(trustedActionCovers(trusted, { kind: "delete", targetId: "x" })).toBe(false);
    expect(trustedActionCovers(trusted, { kind: "external", readOnly: true })).toBe(false);
  });

  it("covers delete only when explicitly listed", () => {
    const trusted = { effectKinds: ["delete" as const] };
    expect(trustedActionCovers(trusted, { kind: "delete", targetId: "x" })).toBe(true);
    expect(trustedActionCovers(trusted, { kind: "create", objectType: "task" })).toBe(false);
  });
});

describe("buildApprovalPrompt", () => {
  it("formats a local-object effect with its payload fields", () => {
    const prompt = buildApprovalPrompt({
      id: "p1",
      createdAt: 0,
      app: "tasks",
      actionType: "tasks.create",
      summary: "Create a task",
      effect: { kind: "create", objectType: "task", payload: { title: "Buy milk" } },
      tier: "writableWithApproval",
      status: "pending",
    });
    expect(prompt.risk).toBe("caution");
    expect(prompt.riskLabel).toBe(RISK_LABELS.caution);
    expect(prompt.dataTouched).toContain("task");
    expect(prompt.dataTouched).toContain("title");
  });

  it("formats an external effect using its externalSummary", () => {
    const prompt = buildApprovalPrompt({
      id: "p2",
      createdAt: 0,
      app: "web",
      actionType: "web.openUrl",
      summary: "Open a link",
      effect: { kind: "external", externalSummary: "Open https://example.com", readOnly: true },
      tier: "writableWithApproval",
      status: "pending",
    });
    expect(prompt.dataTouched).toBe("Open https://example.com");
    expect(prompt.risk).toBe("safe");
  });

  it("prefers the proposal's stored risk/undoNote over recomputing them", () => {
    const prompt = buildApprovalPrompt({
      id: "p3",
      createdAt: 0,
      app: "tasks",
      actionType: "tasks.delete",
      summary: "Delete a task",
      effect: { kind: "delete", targetId: "x" },
      tier: "writableWithApproval",
      status: "pending",
      risk: "safe",
      undoNote: "stored note",
    });
    expect(prompt.risk).toBe("safe");
    expect(prompt.undoNote).toBe("stored note");
  });
});

describe("isCanonicalPermission", () => {
  it("accepts <coreId>.<operation>", () => {
    expect(isCanonicalPermission("cardspoke.read")).toBe(true);
    expect(isCanonicalPermission("secrets.reference")).toBe(true);
  });

  it("rejects unknown cores, unknown operations, and extra segments", () => {
    expect(isCanonicalPermission("nonsense.read")).toBe(false);
    expect(isCanonicalPermission("cardspoke.fly")).toBe(false);
    expect(isCanonicalPermission("cardspoke.read.extra")).toBe(false);
    expect(isCanonicalPermission("cardspoke")).toBe(false);
  });
});

describe("evaluateManifest", () => {
  it("allows a manifest that stays within policy", () => {
    const verdict = evaluateManifest({
      permissions: ["cardspoke.read"],
      dependencies: ["react"],
      network: false,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toHaveLength(0);
  });

  it("flags a non-allowlisted dependency as a violation", () => {
    const verdict = evaluateManifest({
      permissions: [],
      dependencies: ["lodash"],
      network: false,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations[0]).toContain("lodash");
  });

  it("flags network access as a violation under deny-by-default policy", () => {
    expect(SANDBOX_POLICY.networkDefault).toBe("deny");
    const verdict = evaluateManifest({ permissions: [], dependencies: [], network: true });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.some((v) => /network/i.test(v))).toBe(true);
  });

  it("flags a non-canonical permission string as a violation", () => {
    const verdict = evaluateManifest({
      permissions: ["everything"],
      dependencies: [],
      network: false,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("flags any secrets permission other than secrets.reference as a violation", () => {
    const verdict = evaluateManifest({
      permissions: ["secrets.read"],
      dependencies: [],
      network: false,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.some((v) => /secret references only/i.test(v))).toBe(true);
  });

  it("requires approval (not a violation) for write/delete permissions on other Cores", () => {
    const verdict = evaluateManifest({
      permissions: ["cardspoke.write"],
      dependencies: [],
      network: false,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval.some((v) => v.includes("cardspoke.write"))).toBe(true);
  });

  it("records an audit event for every evaluation", () => {
    storage.set(StoreKeys.auditLog, []);
    evaluateManifest({ permissions: [], dependencies: [], network: false });
    const events = storage.get<unknown[]>(StoreKeys.auditLog, []);
    expect(events.length).toBeGreaterThan(0);
  });
});
