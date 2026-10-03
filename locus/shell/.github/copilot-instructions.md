# GitHub Copilot Instructions For Locus OS

Follow `AGENTS.md` first. These instructions add Copilot-specific reminders.

## Required Skill

Before starting any meaningful task, invoke the `spec-driven-development` skill (located at `skills/spec-driven-development/SKILL.md`). It teaches the full instruction hierarchy, per-task reading table, change workflow, and changelog format for this repository.

## Required Context

Before suggesting non-trivial changes, respect:

- `development-docs/coreIdentity.md`
- `development-docs/developmentManifesto.md`
- `development-docs/architecture.md`
- `development-docs/productRoadmap.md`
- `development-docs/design.md` — for any UX/UI, visual, or design-system decisions

## Project Shape

Locus OS is a React/TypeScript/Vite browser PWA with:

- A local-first spatial shell.
- A single app registry in `src/core/appRegistry.ts`.
- Shared `SystemObject` storage in `src/core/objects.ts`.
- Fourteen Core modules in `src/core/cores/`.
- AI governance through permissions, proposals, broker, audit, Security Core, and AI Control Center.

## Suggestion Rules

- Prefer existing Core APIs over app-local duplicate logic.
- Preserve local-first behavior.
- Do not suggest hidden external network calls or telemetry.
- Do not expose raw secrets in code, examples, logs, or generated docs.
- Do not bypass proposal/approval paths for AI writes.
- Keep generated code compatible with the current TypeScript/Vite/browser runtime.
- Use existing design language and component patterns.

## Important Commands

```bash
npm run typecheck
npm run build
npm run dev
```

`npm test` runs the Vitest Core Services suites (`src/**/*.test.ts`, jsdom); `npm run test:watch` reruns on change.
