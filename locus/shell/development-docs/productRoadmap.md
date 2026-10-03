# Locus OS - Product Roadmap

> This roadmap describes version-level direction. It is not a sprint board or changelog.
>
> Update it only when product direction, version scope, or roadmap sequencing changes.

## Roadmap Purpose

This roadmap helps humans and AI agents understand what Locus OS is building toward, which work belongs in the current stabilization phase, what is planned next, and which ideas are intentionally deferred or out of scope.

Interpret this roadmap alongside:

- `development-docs/coreIdentity.md`.
- `development-docs/developmentManifesto.md`.
- `development-docs/architecture.md`.
- `CHANGELOG.md`.
- Local evidence: `locus-os-core-system-audit-2026-07-10.md`, the two `development-docs/coreSystemStatus-2026-07-11*.md` reports, `Core API Focus List.md`, and `Locus_OS_Standard_Apps.md`. Earlier analysis documents named in historical entries were absent from the imported source and are not required reading.

## Product Direction Summary

Locus OS is moving toward a local-first personal operating environment where app surfaces are backed by honest, enforced Core services and AI actions are inspectable, permissioned, and auditable.

The current roadmap is organized around:

1. Stabilizing live data-loss and corruption risks.
2. Making Core claims true in app wiring and runtime enforcement.
3. Hardening privacy, redaction, notifications, secrets, and generated-artifact safety.
4. Extending only after the Core layer becomes a trustworthy foundation.

The project should prioritize:

- Core wiring before new Cores.
- Enforcement before AI autonomy.
- Local data safety before new integrations.
- PWA and spatial-shell coherence before platform expansion.

The project should avoid:

- Adding more Cores while existing Cores are under-wired.
- Treating AI provider/runtime work as more urgent than proposal safety.
- Implementing hidden cloud sync, hidden browser context, or external dispatch.
- Letting roadmap ideas masquerade as current working features.

## Current Product State

**Current Version:** `0.6.0`  
**Current State:** In development / private repo with substantial working browser PWA prototype  
**Last Roadmap Review:** 2026-08-01 (maintainer requested implementation of the next three planned versions; all three delivered — see "Delivered Former Future Versions" below)

### Current Capabilities

- Spatial shell with dense-grid tile placement, snapping, shared borders, presentation modes, saved workspaces, freeform mode, Focus, and edge header segments.
- App registry with 18 app modules and AI capability manifests.
- Local persistence for appearance, workspace layouts, recent apps, audit, objects, sources, notifications, and Core state.
- Shared `SystemObject` store used by Writer, Cards, Tasks, Projects, Files, Search, and related surfaces.
- Fourteen Core modules under `src/core/cores/`.
- AI Assistant with local rule-based read/propose behavior, context inspector, approval queue, and editable memory.
- AI Control Center with provider preference, permission overrides, trusted actions, and credential broker surfaces.
- Connected Sources and indexing metadata surfaces.
- PWA manifest and service worker for production/offline shell behavior.

### Partially Built / Needs Completion

- Security and AI permission tiers are enforced fail-closed AND structurally at the Broker gate against a typed Action Definition registry (`src/core/actionRegistry.ts`); every AI write (Editor, Files, Web, Monitor, Secrets) routes through AI Core.
- Persistence is localStorage with a write-behind IndexedDB durable mirror (boot recovery + quota-failure rescue) and cross-tab-locked transactional updates; full per-object-type transactional records and OPFS byte storage remain the M1 migration.
- Search/Index redaction and exclusions gate the assembled AI context packet; AI retrieval is a separate DTO path (`retrieveForAI`), and the rule-based assistant re-checks scope before answering.
- Secrets values are encrypted at rest (PBKDF2-derived AES-GCM, AAD-bound to the secret id, idle auto-lock), delete is recoverable, and brokered use is a real proposal path; vault-aware redaction only covers values decrypted in the current tab while unlocked.
- Dev Core has the full pipeline plus a Dev authoring app (create, code editor with diff-first apply, validate, sandbox, install, rollback) and a devwidget tile runtime (sandboxed iframe, manifest-gated read-only RPC). Widget write-path RPC and typecheck/lint runners remain future.
- A real model runtime exists as explicit opt-in (endpoint + enablement + remote acknowledgment; brokered keys; audited dispatch; rule-based fallback). The Platform app's request-class routing table is still display-only.
- Files hold real local bytes (OPFS → IndexedDB behind `src/core/byteStore.ts`): import, download, byte-releasing grants, media detection and Blob-URL playback. The File System Access picker, folders/mounts, and per-object-type IndexedDB transactional records remain future.

### Current Product Constraints

- Browser-first PWA runtime.
- No backend service.
- No real model provider wired.
- Vitest covers the Core Services layer; Playwright + real Chromium covers the Dev sandbox, multi-tab, and offline-PWA gates jsdom cannot. CI runs typecheck + unit + build + audit + the Playwright suite on every PR, and the Pages deploy is gated on the same checks.
- LocalStorage is the current persistence backend, with an IndexedDB durable mirror for recovery.

## Current Version Focus

The current version focus is:

> Core Stabilization - make the visible operating model true in code.

### Version Goal

The goal of this version is to tighten Locus OS so existing Cores, permissions, proposals, redaction, notifications, and app surfaces are accurate and enforceable enough to build on.

This version should make the project:

- Safer for local user data.
- More honest about Core status and registry claims.
- More consistent in app-to-Core routing.
- Ready for later file bytes, generated widgets, and model runtime work.

### Version Scope

This version includes:

- Fixing live corruption/data-loss bugs identified in repo analysis.
- Wiring existing app surfaces through their Cores.
- Making Broker consult Security Core for proposal risk and permission tiers.
- Applying redaction and Search/Index paths consistently.
- Making Notification Core policy visible and actually used.
- Hardening Dev Core sandbox and install gates.
- Adding validation/tests where practical for the stabilized contracts.

This version does not include:

- A real cloud AI model runtime unless explicitly promoted.
- Native desktop/mobile wrappers beyond PWA.
- Full cloud sync.
- Full OPFS/native file byte handling unless promoted from next-version work.
- Adding new Cores.

## Current Version Development Items

### 1. Stop Data Loss And Corruption

**Roadmap state:** Current Version  
**Evidence:** local baseline `locus-os-core-system-audit-2026-07-10.md` and `development-docs/coreSystemStatus-2026-07-11-completion.md`

Scope:

- Fix broker update executor so approving Writer AI tidy does not wipe title/tags.
- Route Files delete action through Files Core trash/restore rather than hard delete.
- Guard broker execute paths against denied or already-executed proposals.

Complete when:

- Existing Writer proposal approval preserves object metadata.
- Files can be trashed and restored.
- Denied/executed proposals cannot be re-run.

### 2. Wire Apps Through Existing Cores

**Roadmap state:** Current Version

Scope:

- Search app and assistant use Search/Index Core.
- Cards app uses Cardspoke Core for wiki-links, backlinks, and related objects.
- Files app uses Files Core.
- Assistant writes route through AI Core before Broker.
- Notification senders use Notification Core delivery.

Complete when:

- App behavior no longer bypasses Core-owned safety and retrieval paths for the major audited cases.
- Registry claims are either true or downgraded.

### 3. Make Governance Enforcement Real

**Roadmap state:** Current Version

Scope:

- Broker consults Security Core.
- Proposals store risk, data touched, permission tier, and recovery/undo notes where possible.
- Forbidden capabilities are refused.
- Trusted actions are scope-aware.
- Approval UI shows enough context for informed decisions.

Complete when:

- A forbidden action cannot enter or execute through the normal proposal path.
- Users see risk and data impact before approval.

### 4. Harden Secrets, Redaction, And AI Context

**Roadmap state:** Current Version

Scope:

- Apply redaction at proposal (summary, detail, AND effect payload), Search, AI context, audit/detail, Dev diff, and export choke points where applicable.
- Secret storage is encrypted at rest (PBKDF2-derived AES-GCM, idle auto-lock); the remaining hardening is AAD binding of ciphertext to secret id, locked-vault redaction of stored values, and a recoverable-delete path.
- Continue WebCrypto-based vault hardening (above).

Complete when:

- Raw secret values do not appear in AI-visible or audit/proposal outputs in covered flows.
- Docs accurately describe encryption status.

### 5. Stabilize Dev Core Safety

**Roadmap state:** Current Version

Scope:

- Fix script embedding escape.
- Add sandbox CSP or equivalent runtime network blocking.
- Require latest successful sandbox run before install.
- Build or defer a Dev/Code app surface explicitly.

Complete when:

- Dev Core no longer claims install safety that is not enforced.
- Generated artifacts have a visible validation/sandbox path before installation.

## Current Version Completion Criteria

The current stabilization version is complete when:

- The critical broker metadata wipe and Files hard-delete issues are fixed. ✅
- Major app/Core bypasses named in analysis docs are resolved or documented as intentional. ✅
- Broker, Security Core, and AI Core form a real enforcement path for AI proposals — now a typed Action Definition registry (structural default-deny), with every AI write routed through AI Core. ✅
- Redaction and Search/Index exclusions are consistently used in UI and AI context paths; AI retrieval is a redacted DTO path. ✅
- Notification quiet hours/delivery policy is no longer bypassed by normal Core senders; policy holds and user snoozes are distinct. ✅
- Dev Core sandbox/install claims are enforced (verdict integrity proven by a real-browser adversarial suite) or downgraded honestly. ✅
- `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:e2e` pass. ✅
- README and development docs match current behavior. ✅

The Wave-4 acceptance gates from the baseline audit (unknown/mismatched actions deny; hide-from-AI/exclusions/trash affect one context snapshot; two-tab mutation shows no duplicate/lost effect; recovery export contains memory-only state; Dev sandbox cannot forge success or reach the network; clean-profile offline PWA launch) now pass in unit and/or real-browser tests. The remaining forward work (IndexedDB per-object-type transactional records, OPFS byte storage, a real model runtime, an installed widget runtime) is next-version scope, tracked below — not this version's blockers.

## Delivered Former Future Versions (2026-08-01, maintainer-requested)

The three planned future versions were promoted by explicit maintainer request ("implement the next 3 phases") and delivered as version `0.6.0`. What shipped, and what was honestly left out of each:

### Delivered - Files, Media, And Real Local Bytes (M1)

Shipped: OPFS default byte store with IndexedDB fallback behind `src/core/byteStore.ts` (backend chosen once per session); Files Core as the byte authority (import with content-first kind detection, download, byte manifest, trash keeps bytes / token-gated purge removes them, grants release real bytes + content-detected MIME); Media Core detection and Blob-URL playback over real bytes; Files app import/download/preview; Music tile real playback.

Not shipped (still future): File System Access API grants and folder mounts, IndexedDB handle persistence, dedicated Viewer/Screen surfaces, thumbnails, per-object-type IndexedDB transactional records (the durable mirror remains a key/value recovery layer).

### Delivered - Dev App And Generated Widget Runtime

Shipped: the Dev app authoring surface (artifact list, create, code editor with diff-first apply, validate, sandbox run + logs, install/uninstall with gate reasons, versioned rollback, remove); the `devwidget` tile runtime — installed widget artifacts run in an opaque-origin sandboxed iframe (CSP network deny) whose only OS channel is a token-gated postMessage RPC, fail-closed against the fixed `WIDGET_RPC_KINDS` vocabulary and the artifact's declared manifest permissions, denials audited; real-browser e2e coverage of RPC delivery and CSP network denial.

Not shipped (still future): widget write-path RPC (proposal-routed), typecheck/lint/test runners, dependency bundling.

### Delivered - First Real Model Runtime (M5)

Shipped: `src/core/modelRuntime.ts` — dispatch to a user-configured OpenAI-compatible endpoint, strictly opt-in (enabled + provider preference + valid endpoint; remote endpoints require the Cloud provider setting AND an explicit data-leaves-device acknowledgment that resets on endpoint change); API keys only via the brokered `secrets.use` path (memory-only session arming); every dispatch audited without content; AI Core routing rules consumed at dispatch; model-proposed writes parsed against a strict action allowlist and routed through the identical proposeThroughCore path; rule-based assistant unchanged as default and fallback.

Not shipped (still future): streaming responses, multi-turn conversation memory, honoring a model-suggested reminder time in Time Core's scheduler, verification against a live endpoint (unit tests stub fetch).

## Planned Future Versions

No next version has been scoped since `0.6.0`. Nearest candidates, in rough order of prior direction: the remaining M1 storage work (per-object-type IndexedDB transactional records, File System Access picker), Viewer/Screen media surfaces, streaming + conversation memory for the model runtime, and the widget write-path RPC.

## Long-Term Platform Direction: Locus OS On Linux

**Roadmap state:** Declared product direction (maintainer, 2026-07-10); execution is phase-gated and does not change the current version focus.

Locus OS is eventually to become the shell and service layer of a Linux-based operating system, developed against the `jxburros/locus-linux` repository — wrapper-first (pristine upstream kernel + Locus userspace booting into the Locus shell), with a kernel fork only on demonstrated need.

The canonical plan, two-stage target architecture (kiosk image, then native Core services), phase gates (M0–M6), local readiness workstreams, and open maintainer decisions live in `../docs/integration-plan.md` (relative to the shell package). Agents must consult it (and the `locus-linux-translation` skill) before platform, packaging, storage-backend, or integration decisions.

Sequencing rules:

- Core Stabilization (current version) remains the active focus and is the M0 gate.
- The storage-backend migration is the M1 gate: the byte half (OPFS/IndexedDB behind `byteStore.ts`) shipped in `0.6.0`; per-object-type transactional records behind `storage.ts` remain open before M1 can be called fully complete.
- Daemon, IPC, kernel, image, and compositor work belongs outside this browser shell package under `locus/`, following the local canonical integration plan and its phase gates.

## Later Ideas / Future Candidates

- Native wrappers for desktop or Android.
- Cloud sync with explicit user control.
- Semantic search after deterministic Search/Index behavior is reliable.
- Web page watches with honest CORS/fetch behavior.
- Notification action buttons and per-source mute.
- Expanded standard apps from `Locus_OS_Standard_Apps.md`.

## Deferred Work

- Full platform expansion beyond browser/PWA (now sequenced by `development-docs/linuxIntegrationPlan.md`; phases M1+ remain gated behind Core Stabilization).
- Full compatibility/Bridge runtime.
- Real external connected services beyond declared source scopes.
- Full generated app installation into the compiled app registry.

## Rejected / Out-Of-Scope Directions

The following should not be implemented without explicit maintainer approval and a roadmap update:

- Hidden cloud upload or telemetry by default.
- AI that can mutate user data without proposal, approval, or trusted-action policy.
- A hidden browser/scraper path for AI page contents.
- App-private stores that duplicate Core-owned shared truth.
- Adding more Cores before the fourteen existing Cores are wired and enforced.
- Treating Locus OS as a conventional scrolling dashboard or generic web app starter.

## Open Product Questions

1. What is the next version theme after `0.6.0` (remaining storage headroom vs. media surfaces vs. model-runtime depth)?
2. ~~Should OPFS/native file bytes be next-version scope?~~ Resolved 2026-08-01: delivered (OPFS byte store; FS Access picker still open).
3. ~~Should a real model runtime wait until enforcement is complete?~~ Resolved 2026-08-01: enforcement completed first (0.5.0), runtime delivered as explicit opt-in (0.6.0).
4. Is cloud sync planned, rejected, or deliberately undecided?
5. Which standard apps from `Locus_OS_Standard_Apps.md` should be promoted first after stabilization?

## AI-Coding-Agent Roadmap Guidance

AI agents should:

- Prefer current stabilization work over future capability expansion.
- Check Core ownership before implementing app behavior.
- Avoid implementing future candidates unless the user explicitly promotes them.
- Record meaningful completed work in `CHANGELOG.md`.
- Update this file only when version direction changes.

AI agents should not:

- Treat future candidates as approved current scope.
- Add roadmap items casually during implementation.
- Mark version-level items complete after a small partial change.
- Use this roadmap to override Core Identity or Architecture.

## Roadmap Maintenance Rules

Update this roadmap when:

- Current version focus changes.
- A major capability is promoted, deferred, or rejected.
- A future version becomes current.
- A product direction question is resolved.

Do not update it for:

- Routine bug fixes.
- Small UI changes.
- Ordinary implementation progress.
- Architecture-only changes that belong in `architecture.md`.
- Completed work that belongs in `CHANGELOG.md`.
