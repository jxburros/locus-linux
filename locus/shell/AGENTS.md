# AGENTS.md - Locus OS Agent Instructions

> Shell-specific AI-agent instructions. The enclosing `../../AGENTS.md` governs
> repository boundaries and kernel policy. Paths here are relative to `locus/shell/`
> unless stated otherwise. This shell is maintained locally; no sibling checkout is needed.
>
> Tool-specific files such as `CLAUDE.md` and `.github/copilot-instructions.md` defer to this file unless they describe tool-specific behavior.

## 1. Instruction Hierarchy

When working in this repository, follow this order:

1. User request.
2. `development-docs/coreIdentity.md`.
3. `development-docs/developmentManifesto.md`.
4. `development-docs/architecture.md`.
5. `development-docs/productRoadmap.md`.
6. `AGENTS.md`.
7. Tool-specific overlays such as `CLAUDE.md` or `.github/copilot-instructions.md`.
8. Existing code, tests, and documentation patterns.

If sources conflict, identify the conflict, make the smallest safe decision available, and document the issue.

## 2. Required Skill

Before starting any meaningful task, invoke or read the `spec-driven-development` skill located at `skills/spec-driven-development/SKILL.md`. It contains the full instruction hierarchy, per-task reading table, change workflow, and changelog format for this repository.

## 3. Required Documentation Access

For any meaningful change, read `development-docs/coreIdentity.md`.

Consult:

- `development-docs/developmentManifesto.md` for development standards, AI behavior, safety, validation, workflow, or documentation changes.
- `development-docs/architecture.md` before changing structure, Cores, app registry, tile behavior, storage, persistence, AI, security, secrets, generated artifacts, build, runtime, or external integrations.
- `development-docs/productRoadmap.md` before implementing new product capabilities or changing version scope.
- `development-docs/design.md` before making any UX/UI, visual, or design-system decisions.
- `../docs/integration-plan.md` before platform, packaging, storage-backend, or Linux integration decisions — it is the canonical long-term platform plan. `development-docs/linuxIntegrationPlan.md` is a local navigation pointer.
- `README.md` when setup, usage, commands, features, or public behavior are affected.
- `CHANGELOG.md` for every meaningful session.

## 4. Project Summary

Locus OS is a local-first, AI-aware personal operating environment built as a React/TypeScript/Vite browser PWA.

It exists to provide a spatial OS shell, shared local object model, reusable Core services, and user-governed AI proposal paths.

Important context:

- The desktop is a fixed spatial surface, not a scrolling dashboard.
- Apps are meant to be surfaces over Cores.
- User data is local by default.
- AI writes must be proposal-governed, permissioned, and audited.
- The default assistant is local/rule-based. `modelRuntime.ts` supports explicit opt-in endpoint dispatch; hosting an inference service is future Linux work.

## 5. Non-Negotiable Project Values

Agents must preserve:

- Local-first operation.
- One object, many apps.
- Cores as shared service boundaries.
- Actions as the security boundary.
- Honest distinction between functional, scaffolded, and future behavior.
- Spatial shell continuity.
- Explicit approval, recovery, and audit for AI or destructive actions.

## 6. Required Change Workflow

For every meaningful task:

1. Read the required docs for the task type.
2. Inspect relevant files before editing.
3. Make the smallest safe change.
4. Preserve existing behavior unless the request requires changing it.
5. Avoid unrelated refactors.
6. Validate appropriately.
7. Update documentation affected by the change.
8. Append to `CHANGELOG.md`.
9. Report honestly, including skipped validation or open questions.

## 7. Architecture Source-Of-Truth Rules

`development-docs/architecture.md` is the living source of truth for current architecture.

Update it when a change affects:

- Project structure.
- Core boundaries.
- App registry or tile runtime architecture.
- Storage, persistence, indexing, or source scopes.
- AI, Broker, Security, Secrets, permissions, or audit boundaries.
- Build, runtime, PWA, deployment, or generated artifact formats.

Do not turn it into a changelog or speculative design doc.

## 8. Product Roadmap Rules

`development-docs/productRoadmap.md` is version-level direction, not a task tracker.

Consult it before new capabilities or scope decisions. Update it only when version scope or product direction changes.

Current inferred focus: Core Stabilization.

Do not implement rejected or out-of-scope directions without explicit maintainer approval.

## 9. Changelog Rules

Every meaningful shell development session must append to `CHANGELOG.md` and `../CHANGELOG.md`. Historical entries are retained as provenance, not current instructions.

Use this heading format:

```markdown
## YYYY-MM-DD - Agent: OpenAI Codex (<actual model name>)
```

Use this body format:

```markdown
### Changed
- ...

### Not completed
- ...

### Notes
- ...

### Handover
- Next agent should start with: ...
- Open questions: ...
- Risks or assumptions: ...
```

Never delete, reorder, or rewrite prior changelog entries to hide incomplete work.

## 10. README Rules

Update `README.md` when changes affect setup, usage, dependencies, scripts, product behavior, known limitations, PWA behavior, AI behavior, data handling, or contributor workflow.

Do not update README for purely internal changes unless the public understanding changes.

## 11. Safety, Privacy, And Data Rules

Do not introduce behavior that:

- Deletes user data without recovery or explicit confirmation.
- Leaks secrets.
- Logs sensitive values.
- Sends private local data externally by default.
- Mutates external systems without explicit permission.
- Hides failure.
- Bypasses AI proposal, permission, or audit policy.

Secrets must not appear in logs, generated artifacts, prompts, AI context, issue bodies, changelog entries, or README examples.

## 12. AI Behavior Rules

When working with AI-related code:

- Ground behavior in Core APIs and collected evidence.
- Make uncertainty explicit.
- Use structured outputs where downstream code consumes AI results.
- Keep provider-specific logic isolated.
- Preserve no-model/local behavior until provider runtime is intentionally wired.
- Do not present AI guesses as verified facts.
- Do not allow AI output to override human decisions without explicit design.

## 13. Domain-Specific Rules

- Prefer wiring existing Cores before adding new Cores.
- Treat `src/core/cores/registry.ts` as an inspectable claim that must become true or be downgraded.
- Route AI write actions through AI Core, Security Core, Broker, and Audit Log where possible.
- Use Search/Index Core for redacted retrieval and exclusions.
- Use Files Core for file lifecycle; do not hard-delete file objects from UI paths.
- Treat Dev Core sandbox/install claims as security-sensitive.
- Keep the spatial shell's fixed-surface model intact.

## 14. Code Style

Prefer clear, typed, maintainable TypeScript; small functions; explicit parameters; readable React components; and existing project conventions.

Avoid broad rewrites, hidden magic, hardcoded assumptions that contradict docs, brittle parsing, duplicated Core logic in app surfaces, and dependency additions without a clear reason.

## 15. Important Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run preview
```

`npm test` runs the Vitest Core Services suites (`src/**/*.test.ts`, jsdom); `npm run test:watch` reruns on change.

## 16. Important Paths

| Path | Purpose |
|---|---|
| `src/main.tsx` | App boot and service worker registration. |
| `src/core/` | System services, stores, shell contracts, AI governance. |
| `src/core/cores/` | Fourteen Core service modules. |
| `src/core/appRegistry.ts` | App registry and capability manifests. |
| `src/components/desktop/` | Spatial workspace and tile chrome. |
| `src/apps/` | User-facing app surfaces. |
| `src/types/` | Shared TypeScript contracts. |
| `public/sw.js` | Hand-written service worker. |
| `development-docs/` | Spec-Driven Docs governance. |

## 17. Known Gotchas

- Core analysis docs describe issues found in earlier trees; verify against current code before acting on them.
- Saved filters (Tasks), outline→tasks (Cards), durable trigger payload routing (People Core's birthday-reminder consumer), and the full Dev Core pipeline now have surfaces: the Dev app is the authoring surface (create, code editor with diff-first apply, validate, sandbox run, install, rollback) and installed widget artifacts run on the desktop as `devwidget` tiles (sandboxed iframe + token-gated, manifest-permission-checked read-only RPC via `handleWidgetRpc` — denials audited).
- Broker-gate authorization is structural: it runs against the typed Action Definition registry (`src/core/actionRegistry.ts`), which binds each actionType to its owner Core, permitted proposing apps, effect kind, object/target types, payload-field allowlist, executor owner, governing capability labels, and risk/undo. Unknown actions, a spoofed app, a mismatched effect kind, a disallowed object/target type, an undeclared payload field, or a caller-asserted `readOnly` that disagrees with the definition all deny; the governing label must also sit in a permitted effective tier. Add a definition when you add a new proposal call site.
- Files Core's one-shot access grants separate minting from consumption: approval mints a revocable, expiring grant; `openFileWithGrant` (now async) consumes it at read time (re-validating trash/source) and releases redacted metadata plus real bytes + content-detected MIME for byte-backed files. Bytes live behind `src/core/byteStore.ts` (OPFS → IndexedDB → memory, chosen once per session); Files Core is its only consumer, trash keeps bytes, token-gated empty-trash purges them, and `exportAll()` does not include byte payloads.
- Secrets are encrypted at rest (AES-GCM, PBKDF2) and AAD-bound to the secret id (enc2); enc1/pre-encryption items migrate on first unlock. Delete is recoverable (encrypted vault trash + token-gated purge); brokered use is a real `secrets.use` proposal delivering the value only to a registered internal consumer.
- Persistence: `localStorage` is the session source of truth, mirrored write-behind into IndexedDB (monotonic revisions) for boot recovery + quota failures; `storage.update()` is the cross-tab-locked read-modify-write for security-critical mutations. `storage.get()` returns a stable per-key reference even for absent keys (a fresh fallback literal breaks `useSyncExternalStore`).
- Files can be metadata-only entries (Add) or byte-backed (Import); media detection treats bytes as evidence and names as claims.
- The assistant is local/rule-based by default; a real model runtime dispatches only when the user explicitly configures and enables an endpoint (see `src/core/modelRuntime.ts`), and it falls back to the rule-based path on any refusal or failure.
- Service worker behavior appears in production preview, not the dev server.

## 18. Completion Checklist

Before finishing:

- Confirm relevant docs were consulted.
- Confirm the change respects Core Identity and current architecture.
- Run relevant validation or document why it was skipped.
- Update `CHANGELOG.md`.
- Update README if setup/usage/public behavior changed.
- Update architecture docs if architecture changed.
- Update roadmap only if version direction changed.
- Document incomplete, blocked, or intentionally skipped work.

## Final Principle

Leave Locus OS more coherent, safer, more Core-aligned, and more honest than you found it.

<!-- BEGIN REPO-LOCAL SKILLS -->
## Repo-Local Skills

Repo-specific Codex skills are installed under `.codex/skills/`. When a task matches one of the trigger descriptions below, read that skill's `SKILL.md` before making changes and follow its workflow alongside these repository instructions.

- `local-first-storage-migration-guard`: Use when changing localStorage, IndexedDB, SQLite, import/export, backup/restore, offline-first sync, schema migration, quota handling, or data recovery behavior.
- `ai-provider-api-key-safety`: Use when adding or changing AI provider integrations, BYOK settings, local model endpoints, API-key handling, model allowlists, model selection, request logging, or AI-generated structured outputs.
- `accessibility-responsive-qa`: Use when reviewing or changing keyboard access, focus states, contrast, reduced motion, screen-reader labels, touch targets, mobile layouts, tablet flows, or print views.
- `multi-platform-release-skill`: Use when preparing or validating Vite, PWA, Capacitor Android/iOS, Electron, Tauri, static-file, Sites, or Vercel releases across this portfolio.
- `locus-core-services-architect`: Use when changing Locus spatial shell, app registry, shared SystemObject model, core services, workspace tiles, command palette, local storage, indexer, credentials, audit, or PWA shell.
- `ai-permission-audit-broker`: Use when changing AI capability manifests, trust tiers, proposal/approval/execution lifecycle, forbidden/trusted actions, credential broker, audit log, or AI write boundaries.
<!-- END REPO-LOCAL SKILLS -->

## Locus Skills (`skills/`)

Tool-agnostic repo skills live under `skills/<name>/SKILL.md`. Read the matching skill before starting a task it covers:

- `spec-driven-development`: Required before any meaningful task (see Section 2).
- `locus-platform-portability`: Use when changing anything under `src/core/`, adding browser API usage or dependencies, changing storage/persistence, or designing/changing a Core API — keeps code portable toward the Linux form.
- `locus-linux-translation`: Use for platform/packaging decisions, native/OS-adjacent features, or integration-plan work — maps each Locus concept to its `locus-linux` counterpart.
- `locus-shell-design-language`: Use when creating or changing any UI — hard design rules plus a section index into `development-docs/design.md`.
- `locus-validation-loop`: Use before finishing any code change — which validation applies per change type, Core test conventions, and honest reporting.


