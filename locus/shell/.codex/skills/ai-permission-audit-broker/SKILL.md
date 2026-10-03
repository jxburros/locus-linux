---
name: ai-permission-audit-broker
description: "Use when changing AI capability manifests, trust tiers, proposal/approval/execution lifecycle, forbidden/trusted actions, credential broker, audit log, or AI write boundaries."
---

# AI Permission and Audit Broker

## Best-Fit Repositories

- `locus-os`
- `faux-os-pwa`
- `AI-Server-Studio`
- `Astra-log`

## Workflow

- Map capability declaration, user override, effective permission, proposal creation, approval gate, execution, and audit event.
- Test blocked, suggest-only, approval-required, trusted, and forbidden paths separately.
- Keep credentials as brokered capabilities or references, never raw values exposed to apps or AI context.
- Log every permission change and AI action transition.

## Guardrails

- Do not let an app alter its own permissions.
- Do not default new write actions into Trusted.
- Do not put secrets into AI context packets, audit display text, or exported logs.

## Validation

- Run unit/type checks.
- Exercise deny/approve flows manually or with tests.
- Inspect audit log for complete transitions and redaction.
