---
name: locus-core-services-architect
description: "Use when changing Locus spatial shell, app registry, shared SystemObject model, core services, workspace tiles, command palette, local storage, indexer, credentials, audit, or PWA shell."
---

# Locus Core Services Architect

## Best-Fit Repositories

- `locus-os`
- `faux-os-pwa`
- `CardSpoke`
- `Pal-Plant`

## Locus Core Map

- Read order is repo-specific: `AGENTS.md` requires `development-docs/coreIdentity.md` before meaningful changes and `development-docs/architecture.md` for Cores, registry, storage, AI, security, secrets, build, runtime, or integrations.
- Core modules live under `src/core/cores/`; the inspectable Core service registry is `src/core/cores/registry.ts`.
- App registry and capability manifests live in `src/core/appRegistry.ts`; tile metadata lives in `src/core/tileMeta.ts`; component tile registry lives in `src/components/tiles/registry.tsx`.
- Shared object model lives in `src/types/objects.ts` and `src/core/objects.ts`; storage facade and `StoreKeys` live in `src/core/storage.ts`.
- AI write lifecycle owners are `src/core/broker.ts`, `src/core/cores/security.ts`, `src/core/permissions.ts`, `src/core/audit.ts`, and `src/core/cores/secrets.ts`.
- The current implementation persists through localStorage behind `src/core/storage.ts`; direct app-level localStorage writes contradict the architecture unless isolated as legacy or explicitly approved.

## Workflow

- Read Locus `AGENTS.md`, `development-docs/coreIdentity.md`, `development-docs/architecture.md`, and source maps before touching core services.
- Keep apps as lenses over shared core services, not siloed storage systems.
- Route persistence through the storage core and shared object model where the architecture requires it.
- Preserve spatial surface invariants: fixed workspace, tile metadata, focus projection, edge widgets, and registry ownership.

## Guardrails

- Do not let app modules write directly to localStorage unless the core contract allows it.
- Do not bypass audit, permission, credential, or broker layers for AI-capable actions.
- Do not treat faux-os-pwa as the current source of truth when Locus has superseded it.

## Validation

- Run `npm run typecheck`.
- Run build.
- Smoke dashboard/focus/settings/audit flows in browser.
