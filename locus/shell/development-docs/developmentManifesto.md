# Locus OS - Development Manifesto

> Read `development-docs/coreIdentity.md` first.
>
> This document governs how humans and AI agents should change Locus OS.

## Purpose of This Manifesto

This document defines how Locus OS should be developed.

The repo is a React, TypeScript, and Vite PWA with a spatial shell, shared local object model, fourteen Core services, and governed AI proposal infrastructure.

Development work should be:

- Local-first.
- Evidence-driven.
- Small enough to review.
- Honest about what is working versus scaffolded.
- Safe around user data, secrets, and external actions.
- Aligned with the Core-services architecture.

## Development Standard

> Build the system so it is local-first, Core-centered, auditable, recoverable, and honest about its capabilities.

When tradeoffs arise, prefer:

- Core APIs over duplicated app logic.
- Explicit user approval over silent automation.
- Recoverable changes over destructive writes.
- Accurate documentation over aspirational completeness.
- Boring, typed, testable code over clever abstractions.
- Working local behavior over cloud-dependent promises.

## Core Development Principles

### 1. Cores Own Shared Truth

If multiple apps need a capability, the capability belongs in a Core or an existing Core API.

Apply this by routing apps through Core APIs, reducing direct object-store bypasses, and keeping registry claims aligned with actual consumers.

### 2. Governance Must Become Enforcement

Capability tiers, Security Core, AI Core, Broker, Secrets Core, Dev Core, and Audit Log should enforce behavior rather than merely display intent.

Apply this by making writes flow through proposal and approval paths, refusing forbidden actions, recording risk and audit events, and treating trusted actions as scoped exceptions.

### 3. Local-First Is A Constraint, Not A Theme

Local-first affects storage, sync, AI providers, file handling, and generated app behavior.

Apply this by keeping local operation useful without provider configuration, isolating external integrations, and documenting all network and provider assumptions.

### 4. The Spatial Shell Is Product Architecture

The desktop, tile registry, Focus projection, header-as-tiles, and dense unit grid are not replaceable presentation details.

Apply this by preserving spatial continuity, using existing tile/app registry patterns, and avoiding page-style rewrites that break the OS surface.

### 5. Documentation Is Part Of The System

Future agents will act on these documents. Incorrect docs create real bugs.

Apply this by updating architecture docs only for current truth, logging meaningful changes in the changelog, and marking unconfirmed maintainer intent explicitly.

## Project-Specific Development Doctrine

### Core Wiring Before New Cores

The repository already has fourteen Cores. Audits identify the main problem as under-wiring and under-enforcement, not missing Core count.

Development work should:

- Wire existing app surfaces through Cores they already claim to use.
- Tighten contracts before adding new surfaces.
- Make `src/core/cores/registry.ts` honest by either implementing claimed events/consumers or downgrading claims.

Development work should not:

- Add a fifteenth Core before the existing Core contracts are enforced.
- Build new app-private stores for behavior already modeled by a Core.
- Treat registry metadata as truth when code contradicts it.

### AI Writes Require A Governed Path

AI behavior should route through AI Core, Security Core, Broker, and Audit Log.

Development work should:

- Use Core-specific AI views such as `describeUpcoming`, `cardForAI`, `contactForAI`, and redacted search snippets.
- Render proposal risk, data touched, undo/recovery information, and diffs where available.
- Preserve no-model and local-rule-based behavior until a real model runtime is intentionally added.

Development work should not:

- Let AI directly call raw object mutations.
- Send local context to a cloud model by default.
- Claim a model/provider is active when it is not wired.

### Secrets And Redaction Are System Boundaries

Secrets Core, Security Core, Search/Index Core, Dev Core, and Broker all touch potential sensitive data.

Development work should:

- Use secret references and brokered use.
- Apply redaction at outbound choke points.
- Avoid putting raw secret values into proposals, notifications, audit details, snippets, generated artifacts, or AI context.

Development work should not:

- Store raw secrets as `SystemObject`s.
- Log secrets.
- Treat base64 obfuscation as encryption.

## AI Role In Development

AI agents may help with implementation, refactoring, tests, docs, architecture analysis, changelog maintenance, and review preparation.

AI agents must not be treated as the final authority. The source of truth is, in order:

1. The user's explicit request.
2. `development-docs/coreIdentity.md`.
3. This manifesto.
4. `development-docs/architecture.md`.
5. `development-docs/productRoadmap.md`.
6. Existing code, tests, and direct validation evidence.

AI-assisted development should be evidence-based, scoped, reversible when possible, documented, and honest about uncertainty.

AI agents must not invent product direction, ignore documented constraints, rewrite unrelated systems, hide validation gaps, or make destructive changes without explicit instruction.

## Change Discipline

For every meaningful change:

1. Read the relevant governance documents.
2. Inspect the files involved before editing.
3. Make the smallest safe change.
4. Preserve existing behavior unless the task explicitly changes it.
5. Avoid unrelated refactors.
6. Run relevant validation.
7. Update docs affected by the change.
8. Append to `CHANGELOG.md`.
9. Report skipped validation, open questions, and risks honestly.

## Architecture Source Of Truth

`development-docs/architecture.md` describes the current architecture. Update it when actual architecture changes.

Update it for:

- Major subsystem changes.
- Module boundary changes.
- Storage, persistence, sync, or caching changes.
- External integrations or providers.
- AI, security, permission, secret, or broker boundary changes.
- Build, runtime, deployment, or generated artifact changes.

Do not update it for small localized fixes, copy changes, CSS tweaks, or refactors that do not change module boundaries.

## Safety, Privacy, And Non-Destructive Behavior

Development work must protect user data, secrets, connected sources, and generated artifacts.

By default, code must not:

- Delete user data without recovery or explicit confirmation.
- Leak secrets.
- Log sensitive values.
- Send private data externally.
- Deploy, sync, or mutate external systems automatically.
- Hide failures behind success messages.
- Bypass approval policy.

Destructive or external behavior must be explicit, scoped, reviewable, documented, and reversible where practical.

## Architecture And Modularity Expectations

Prefer:

- Typed Core APIs.
- Single-purpose modules.
- Explicit data flow.
- React components as surfaces, not policy owners.
- Provider-specific code isolated behind Core or platform boundaries.
- Plain TypeScript over hidden magic.

Avoid:

- Circular dependencies.
- Business logic buried in UI components when a Core owns it.
- Direct localStorage access outside `src/core/storage.ts`.
- Direct object-store bypass where a Core API exists.
- Adding dependencies before checking whether the current stack already supports the need.

## Testing, Validation, And Evidence Expectations

Use the repo scripts:

```bash
npm install
npm run typecheck
npm run build
npm run dev
npm run preview
npm test
```

Vitest (with jsdom) is the project's test runner, added during the Core stabilization pass. Core Services layer tests live beside their Core as `src/core/cores/<core>.test.ts` and run against real `src/core/storage.ts` (via jsdom's `localStorage`), not a mocked persistence layer, so they exercise the same code path the browser runs.

Validation expectations:

- Run `npm run typecheck` for TypeScript changes.
- Run `npm test` for Core Services layer changes — every Core should have a regression suite covering its owned behavior.
- Run `npm run build` for production, PWA, bundling, or broad UI changes.
- Use browser/manual verification for shell, tile, workspace, PWA, or visual behavior.
- Record validation gaps in `CHANGELOG.md`.

## Documentation Requirements

Update:

- `CHANGELOG.md` for every meaningful session.
- `README.md` when setup, usage, scripts, features, known limitations, or user-facing behavior change.
- `development-docs/architecture.md` when current architecture changes.
- `development-docs/productRoadmap.md` only when version scope or product direction changes.
- `development-docs/coreIdentity.md` only when project identity, hard constraints, or anti-goals change.

## Dependency And Configuration Philosophy

Dependencies should remain small and justified. Runtime dependencies are currently only `react` and `react-dom`; the rest of the stack is TypeScript, Vite, and hand-rolled platform code.

Before adding a dependency, confirm it:

- Supports the local-first browser/PWA runtime.
- Does not introduce hidden network behavior.
- Is worth its long-term maintenance cost.
- Does not weaken bundle transparency or user trust.

## Error Handling And Failure Honesty

The system should distinguish success, failure, warning, blocked behavior, partial completion, unsupported behavior, missing configuration, and future placeholders.

Do not claim:

- A Core enforces a policy unless code enforces it.
- AI is connected to a model unless a model runtime is wired.
- Secrets are encrypted unless WebCrypto or equivalent encryption is implemented.
- A sandbox denies network unless runtime policy enforces it.

## Agent Operating Rules

AI agents must:

1. Read `development-docs/coreIdentity.md` before meaningful changes.
2. Consult this manifesto for development, validation, safety, and documentation rules.
3. Consult `development-docs/architecture.md` before changing structure, Cores, storage, AI, security, build, or runtime behavior.
4. Consult `development-docs/productRoadmap.md` before implementing new capabilities or changing version scope.
5. Make the smallest safe change.
6. Avoid unrelated refactors.
7. Validate when possible.
8. Update `CHANGELOG.md`.
9. Update README and architecture docs when affected.
10. Stop and ask when a request conflicts with hard constraints, rejected roadmap items, or architectural invariants.

## Definition Of Done

A task is done only when all applicable items are true:

- Requested scope is implemented.
- Relevant governance docs were consulted.
- The change respects local-first, Core-centered, auditable design.
- Existing behavior is preserved unless intentionally changed.
- Relevant validation was run, or skipped validation is documented.
- `CHANGELOG.md` was updated.
- `README.md` was updated if user-facing behavior, setup, commands, or limitations changed.
- `architecture.md` was updated if architecture changed.
- `productRoadmap.md` was updated only if version scope or product direction changed.
- Incomplete, blocked, or intentionally skipped work is recorded honestly.

## Maintainer Confirmation Needed

The following should be confirmed before treating them as permanent policy:

- Whether `npm run build` should be required before every PR or only broad/frontend changes.
- Whether no telemetry and no default cloud provider should be permanent hard rules.

## Final Principle

Leave Locus OS more coherent than you found it: more truthful about its current state, safer around user data, more routed through Cores, and easier for the next maintainer or agent to understand.
