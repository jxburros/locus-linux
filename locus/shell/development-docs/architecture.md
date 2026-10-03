# Locus OS - Architecture

> This document describes the current architecture of Locus OS.
>
> Update it when actual structure, data flow, storage, AI, security, build, runtime, or generated-artifact architecture changes. Do not use it as a roadmap.

## Repository scope

This document describes `locus/shell/` in the Linux repository. Paths and npm
commands below are relative to that package. The enclosing `locus/README.md`
and `locus/docs/integration-plan.md` own repository layout and platform gates.
The complete shell and Core source and tests are local; no sibling checkout or
remote bundle is used. `dist/` is generated here for preview and future image
assembly. The imported GitHub Pages and CI workflows are not active in this
package; run the validation targets documented in the enclosing README.
Only the SVG source icon is retained; PNG-only touch-icon support is not claimed.
The `/locus-os/` serving path is preserved for Vite, manifest, worker, and tests.

## Architecture Summary

Locus OS is a React, TypeScript, and Vite browser PWA that implements a local-first personal operating environment.

At a high level, the system:

1. Boots a React app from `src/main.tsx`.
2. Persists local state through `src/core/storage.ts`.
3. Renders a fixed spatial workspace through shell and desktop components.
4. Registers apps through a single `APPS` registry.
5. Stores user-created data in a shared `SystemObject` store.
6. Exposes reusable capabilities through fourteen Core modules.
7. Routes AI-related reads and writes through context packets, capability manifests, proposals, approvals, and audit records.

The architecture is designed around local-first storage, one shared object model, Core-owned capabilities, spatial UI continuity, explicit AI permissions, and auditability.

## System Responsibilities

This repo is responsible for:

- The browser/PWA shell.
- Spatial tile workspace, Focus, freeform layouts, edge header segments, launchers, command palette, and app surfaces.
- Local state and object persistence.
- The app registry and capability manifests.
- Core services for time, cards, editing, files, search, people, monitoring, web, AI, secrets, security, notifications, media, and development artifacts.
- AI context assembly, proposal lifecycle, permission display, trusted actions, and local audit history.

This repo is not currently responsible for:

- Native desktop or mobile system integration beyond PWA install behavior.
- Real cloud sync.
- Hosting model inference itself (it can dispatch to a user-configured endpoint; it does not run models).
- Native filesystem access outside the browser's origin-private storage (file bytes live in OPFS/IndexedDB via `src/core/byteStore.ts`; the File System Access picker and native mounts remain future).
- Server-side backend persistence.
- A general hidden browser or scraper for AI.

## System Boundaries

### This Repo Owns

- React app source under `src/`.
- PWA manifest, service worker, and icons under `public/`.
- Local object and settings stores.
- Core service contracts.
- App registry and shell runtime.
- Local AI governance model.

### Browser Platform Owns

- `localStorage`.
- PWA install and service worker runtime.
- New-tab URL opening.
- Device APIs that may be used later behind explicit user grants.

### User Configuration Owns

- Appearance theme, accent, density, and system name.
- Workspace layouts, tile placement, header segments, and saved workspaces.
- AI provider preference and permission overrides.
- Connected source scopes and exclusions.
- Trusted actions and credential grants.

### Human Maintainers Own

- Product direction.
- Hard constraints and rejected directions.
- Whether external providers, sync, native files, or model runtimes are promoted from scaffolds to working features.

## Directory And File Map

```text
/
├── src/
│   ├── main.tsx                       - React entrypoint; boots app and service worker registration.
│   ├── core/                          - System services, stores, policy, AI, shell contracts.
│   │   ├── storage.ts                 - Namespaced localStorage wrapper + IndexedDB durable mirror + cross-tab locks.
│   │   ├── byteStore.ts               - File BYTES seam: OPFS → IndexedDB → memory, chosen once per session.
│   │   ├── modelRuntime.ts            - Opt-in model runtime: gated dispatch to a user-configured endpoint.
│   │   ├── objects.ts                 - Shared SystemObject store (revisions, generic trash, destructive tokens).
│   │   ├── desktop.ts                 - Desktop layouts, tiles, header, workspaces.
│   │   ├── appRegistry.ts             - Single registry of app modules and AI capability manifests.
│   │   ├── actionRegistry.ts          - Typed Action Definition registry (the structural authorization contract).
│   │   ├── broker.ts                  - AI action proposal lifecycle (lock-serialized, async).
│   │   ├── permissions.ts             - App capability declarations plus user overrides.
│   │   ├── aiContext.ts               - AI context packet assembly.
│   │   ├── audit.ts                   - Local audit event store.
│   │   ├── assistant.ts               - Current local rule-based assistant.
│   │   ├── cores/                     - Fourteen Core service modules and registry.
│   │   └── ...                        - Theme, notifications, sources, platform, geometry, snapping.
│   ├── components/
│   │   ├── Shell.tsx                  - Top-level shell context and keyboard behavior.
│   │   ├── SafeMode.tsx               - Root error boundary + boot-failure recovery surface.
│   │   ├── CommandPalette.tsx         - Command launcher.
│   │   ├── desktop/                   - Spatial workspace, tile frame/menu/settings, drag/drop.
│   │   ├── tiles/                     - Tile renderers and tile registry.
│   │   └── anchors/                   - Anchor previews.
│   ├── apps/                          - User-facing app surfaces.
│   ├── types/                         - Shared TypeScript types.
│   └── styles/                        - Design tokens and global CSS.
├── public/
│   ├── manifest.webmanifest           - PWA manifest.
│   ├── sw.js                          - Hand-written service worker.
│   └── icons/                         - PWA icons.
├── e2e/                               - Playwright real-browser integration tests (sandbox, multi-tab, offline PWA).
├── development-docs/                  - Spec-Driven Docs governance.
├── AGENTS.md                          - Canonical AI-agent instructions.
├── CLAUDE.md                          - Claude-specific overlay.
├── .github/copilot-instructions.md    - GitHub Copilot overlay.
├── CHANGELOG.md                       - Meaningful change history.
├── package.json                       - npm scripts and dependencies.
├── vitest.config.ts                   - Vitest config (jsdom) for Core Services layer tests.
├── playwright.config.ts               - Playwright config (real Chromium) for integration tests.
└── README.md                          - Public project overview and usage.
```

## Major Subsystems

### Spatial Shell

**Location:** `src/components/Shell.tsx`, `src/components/desktop/`, `src/core/desktop.ts`, `src/core/surface.ts`, `src/core/snap.ts`, `src/core/focusLayout.ts`, `src/components/tiles/`

The shell renders the fixed workspace, tile placement, tile resizing, snapping, shared borders, presentation modes, header edge segments, dashboard/focus/freeform/app/settings access, command palette, and onboarding.

Important boundaries:

- The surface should remain spatial and non-scrolling.
- Focus is a projection of the same layout, not navigation away from the desktop.
- Tile geometry and metadata should remain centralized in Core/desktop/tile modules.

### App Registry

**Location:** `src/core/appRegistry.ts`, `src/types/app.ts`

The `APPS` array is the system's app map. Launcher, command palette, Search, AI Control Center, tiles, and app surfaces consume app metadata from it.

Each app entry includes id, name, description, category, status, component, search keywords, optional anchor preview, and AI capability manifest.

Important boundaries:

- Adding an app means adding a component and one registry entry.
- Apps should publish capabilities honestly.
- Apps should not grant themselves permissions at runtime.

### Shared Object Store

**Location:** `src/core/objects.ts`, `src/types/objects.ts`, `src/core/hooks.ts`

The object store is the local shared source of truth for documents, cards, tasks, projects, files, and memory.

Important boundaries:

- Apps may display and edit objects, but Core APIs should own shared behavior where one exists.
- Direct object-store access should be reduced when it bypasses Core-owned policy, trash, redaction, links, or date logic.

### Core Services Layer

**Location:** `src/core/cores/`

The fourteen Cores are:

- Time: alarms, timers, events, reminders, recurrence, triggers.
- Cardspoke: cards, tasks, documents, links, backlinks, tags, conversions.
- Editor: text operations, undo/redo, diffs, AI edit transactions, export.
- Files: file metadata, real local bytes (via the byteStore seam), recents, trash/restore, source grants, brokered access.
- Search/Index: query grammar, ranking, relationships, redacted snippets.
- People: contacts, groups, birthdays, cadence, interaction history.
- Monitor: watches, checks, stale items, alert history.
- Web: web app shortcuts, URL opening, page-context and page-watch seams.
- AI: routing rules, context assembly, proposal routing.
- Secrets: secret references, brokered use, redaction, reveal audit.
- Security: permission tiers, risk, sandbox policy, manifest evaluation.
- Notification: delivery, quiet hours, snooze, grouping.
- Media: media metadata, content-based (magic-number) detection, and Blob-URL playback over byte-backed files.
- Dev: generated code artifacts, manifests, diffs, validation, sandbox, install, rollback, and the devwidget tile runtime (manifest-gated read-only RPC for installed widgets).

Important boundaries:

- Cores should be small contracts that compose.
- The current audit evidence says many APIs are under-wired; new work should generally wire and enforce existing Cores before adding more.

### AI Governance Layer

**Location:** `src/core/assistant.ts`, `src/core/aiContext.ts`, `src/core/broker.ts`, `src/core/permissions.ts`, `src/core/cores/ai.ts`, `src/core/cores/security.ts`, `src/apps/assistant/`, `src/apps/ai-control/`, `src/apps/audit-log/`

The current assistant is local and rule-based. It can answer reads and create proposals for writes. AI Control Center displays provider preferences, effective permissions, trusted actions, and credential broker surfaces.

Model runtime state:

- A real model runtime exists but is opt-in and off by default (`src/core/modelRuntime.ts`): the assistant's async entry (`interpretAsync`) dispatches to a user-configured OpenAI-compatible endpoint only when the runtime is enabled, the provider preference is not "None", and — for remote endpoints — the provider is "Cloud" AND an explicit data-leaves-device acknowledgment is checked (the acknowledgment resets when the endpoint changes). Refused dispatches never touch the network, and every dispatch is audited (`ai.dispatched`: model, host, outcome, duration — never prompt, response, or key). API keys reach the adapter only through Secrets Core's brokered `secrets.use` path, arming a memory-only session key. On any refusal or failure the assistant falls back to the unchanged rule-based `interpret()` with an honest `via` explanation. Model-proposed writes parse through a strict action allowlist and reuse the exact `proposeThroughCore` payloads of the rule-based branches — governance is identical on both paths.
- Security Core is enforced at the Broker gate (propose/approve/execute) fail-closed AND structurally: authorization runs against a typed **Action Definition registry** (`src/core/actionRegistry.ts`) binding each actionType to its owner Core, permitted proposing apps, effect kind, object/target types, payload-field allowlist, executor owner, governing capability labels, and risk/undo. Unknown actions, a spoofed proposing app, a mismatched effect kind, a disallowed object/target type, an undeclared payload field, or a caller-asserted `readOnly` flag that disagrees with the definition all deny by default. Action semantics are no longer matched by mutable label prose.
- Every AI write traverses AI Core: Editor, Files, Web, Monitor, and Secrets requests all route through `proposeThroughCore`, which derives the verified `originCore` from the Action Definition registry before the Broker sees the proposal.
- The assembled AI context packet honors hide-from-AI tiles, source readability, index exclusions, and trash, and now includes approved page-context captures; the rule-based assistant's direct read branches (upcoming, follow-ups, task counts) re-check the packet's scoped-app set before answering.
- AI retrieval and user search are distinct APIs: `retrieveForAI`/`relationshipsForAI` return redacted, source-authorized DTOs so no raw `SystemObject` crosses the AI boundary.

### Persistence Layer

**Location:** `src/core/storage.ts`

All local persistence passes through the namespaced storage wrapper. `localStorage` is the synchronous source of truth for the session; a write-behind **IndexedDB durable mirror** is the recovery layer and quota-overflow net.

Failure honesty, durability, and concurrency are part of the storage contract:

- Reads cache parsed snapshots by raw string, and return one stable per-key reference even for absent or invalid keys, so `useSyncExternalStore` consumers never get a fresh reference each render (a fresh fallback literal per call spins an infinite re-render loop).
- A value that fails to parse is preserved under a `corrupt:` backup key and reported through `onStorageFailure` instead of being silently replaced.
- Every write is mirrored, write-behind and coalesced, into an IndexedDB record store with a monotonic per-key revision. Write failures (quota, private mode) keep the value in memory AND in the durable mirror, notify subscribers, and surface a critical notification via the boot-time handler in `main.tsx`.
- `initStorage()` hydrates from the mirror at boot BEFORE seeding or Core init: keys `localStorage` lost (cleared, evicted, or a quota-failed write only the mirror captured) are restored, so the booted state and the recovery export contain the newest data. A user's explicit reset clears the mirror too.
- `storage.update()` is a transactional read-modify-write under an exclusive cross-tab Web Lock (per-key in-tab queue as fallback) — the fencing primitive the Broker lifecycle and other security-critical mutations use so two tabs cannot double-apply a transition or lose a record to a stale-cache overwrite.
- `storage.exportAll()` returns every Locus-owned key as one portable object (overlaying memory-only values); Settings > Storage and the root **Safe mode** surface expose it as a JSON download. Safe mode (a root error boundary + boot-failure fallback) also offers per-store reset and retry instead of a blank page.

File bytes are a separate seam: `src/core/byteStore.ts` stores one byte payload per file id in OPFS (directory `locus-bytes`) when available, falling back to IndexedDB blobs (DB `locus-bytes`) and then to an in-memory map. The backend is chosen once per session. Files Core is the only consumer — it keys payloads by file object id (`file.ref: "bytes:<id>"`), keeps a small JSON manifest under `StoreKeys.fileBytes` for usage readouts, keeps bytes through trash, and purges them on token-gated empty-trash. `storage.exportAll()` does NOT include byte payloads; per-file download in the Files app is the byte export path.

Important boundaries:

- The key/value store is for metadata and local state; file bytes go through `byteStore.ts` only.
- The durable mirror is a recovery/quota layer over the same key/value model — full transactional records per object type remain future work and should preserve app APIs by changing Core/storage layers, not every app.

### PWA Runtime

**Location:** `public/manifest.webmanifest`, `public/sw.js`, `vite.config.ts`, `src/main.tsx`

The service worker is hand-written and registers only in production builds. A Vite plugin injects the built hashed JS/CSS asset paths into `sw.js` at build time, so `install` precaches the full shell and the **first** launch is offline-capable (no "one online load first" caveat); cache matching uses `ignoreVary`/`ignoreSearch` so precached bundles still match at launch. PWA installation and offline shell behavior are part of the public product promise, and are covered by a real-browser Playwright offline-launch test.

## Execution Flow

```text
index.html
  -> src/main.tsx
  -> bootstrap local stores and providers
  -> render Shell
  -> Shell reads desktop/app/core state
  -> Workspace projects tile geometry onto the fixed surface
  -> App registry selects app components
  -> Apps read/write local objects and Core services
  -> Broker/Audit/Notification record governed actions
```

## Data Flow

### Local Object Flow

```text
user action in app
  -> app component or Core API
  -> SystemObject mutation
  -> storage write under locus namespace
  -> subscription update
  -> app/search/project/tile surfaces re-render
```

### AI Proposal Flow

```text
user prompt
  -> local assistant interpretation
  -> context packet and/or proposed effect
  -> broker proposal queue
  -> user approval or trusted action
  -> object/core mutation
  -> audit log and notification
```

The Security Core gate (`authorizeProposal`) runs at propose, approve, and execute against the typed Action Definition registry with the proposing app's effective capability tiers: forbidden action types are refused; an unknown actionType, a proposing app the definition does not name, a mismatched effect kind, a disallowed object/target type, an undeclared payload field, or a caller-asserted `readOnly` that disagrees with the definition all deny; and the definition's governing label must sit in a permitted effective tier (writable/trusted to write, any non-forbidden tier for a read-only external). Trusted actions auto-run only the effect kinds they explicitly cover, and only while the capability sits in the Trusted tier. The whole lifecycle is lock-serialized (`storage.update`), so two tabs cannot double-execute one proposal.

### Search And Context Flow

```text
objects, apps, contacts, sources
  -> Search/Index Core or raw object search
  -> ranked results/snippets
  -> Search UI or AI context
```

The Search app and the assistant both retrieve through Search/Index Core (`searchAll` / `buildContextSnippets`), which applies index exclusions, trash filtering, and Secrets Core redaction before truncation. The command palette searches apps and commands only, not user objects.

## State, Storage, And Persistence

| State | Location | Persistence | Purpose |
|---|---|---|---|
| App settings and theme | `src/core/theme.ts`, storage keys | localStorage | Appearance and system name. |
| Desktop layouts | `src/core/desktop.ts` | localStorage | Workspaces, tiles, header segments, freeform state. |
| System objects | `src/core/objects.ts` | localStorage | Shared user data. |
| Audit events | `src/core/audit.ts` | localStorage | Local action history. |
| Notifications | `src/core/notifications.ts` and Notification Core | localStorage | Attention inbox. |
| Sources and indexing | `src/core/sources.ts`, `src/core/indexing.ts` | localStorage | Connected scopes and metadata summaries. |
| Secrets | `src/core/cores/secrets.ts` | localStorage | Secret references; values encrypted at rest (AES-GCM via PBKDF2-derived key), AAD-bound to the secret id. Legacy/enc1 items migrate on first unlock. Recoverable delete via an encrypted vault trash. |
| Dev artifacts | `src/core/cores/dev.ts` | localStorage | Generated artifacts, versions, validation state. |
| Durable mirror | `src/core/storage.ts` | IndexedDB | Write-behind mirror of every key with a monotonic revision; boot hydration + quota-failure recovery. |
| File bytes | `src/core/byteStore.ts` (Files Core only) | OPFS → IndexedDB → memory | One byte payload per imported file id; manifest under `StoreKeys.fileBytes`; not part of `exportAll()`. |

## Configuration Model

Primary configuration is code and local user settings:

- `package.json` controls scripts and dependencies.
- Vite/TypeScript configs control build behavior.
- App registry controls installed app surfaces and capability manifests.
- Local settings control appearance, provider preference, permissions, sources, and trusted actions.

There is no server-side config or required environment variable in the current app.

## External Services And Integrations

| Integration | Used By | Required? | Current Behavior |
|---|---|---:|---|
| Browser localStorage | Core storage | Yes | Main persistence backend. |
| Browser service worker | PWA runtime | Production build only | Precaches shell assets. |
| New-tab URL opening | Web Core / Browser app | Optional user action | Opens external URLs on explicit user action. |
| AI providers | AI Control Center / Platform | No | Opt-in model runtime: dispatch only to a user-configured endpoint after explicit enablement (see AI architecture below). |
| OPFS / IndexedDB bytes | `src/core/byteStore.ts` via Files Core | No (graceful fallback) | Real local file bytes; OPFS preferred, IndexedDB blob fallback, memory last resort. |

## AI Architecture And Provider Boundaries

AI is currently represented by:

- A rule-based assistant plus a model-aware async entry (`interpretAsync`) in `src/core/assistant.ts`.
- The opt-in model runtime adapter in `src/core/modelRuntime.ts` (config under `StoreKeys.modelRuntime`; endpoint classification via Web Core's `isPrivateHost`).
- Context packet assembly in `src/core/aiContext.ts` — the packet is also what a dispatched system prompt is built from, already redacted and permission-scoped, and its consumption for dispatch is logged as a context read.
- AI route table and routing rules in `src/core/cores/ai.ts` — routing rules are now consumed at dispatch (modelHint overrides; a "local" route refuses a remote endpoint).
- Capability tiers in app manifests and `src/core/permissions.ts`.
- Proposal lifecycle in `src/core/broker.ts`.
- Permission and model-runtime configuration UI in AI Control Center.

The core experience must remain fully functional with the runtime disabled (the default); the rule-based path is the permanent fallback, not a temporary stub.

Provider-specific logic stays isolated in `src/core/modelRuntime.ts` — the one module allowed to talk to a model endpoint — not spread through app surfaces. The Platform app's request-class routing table remains display-only scaffolding.

## Security, Privacy, And Secrets Boundaries

Security-sensitive architecture includes:

- App capability manifests in `appRegistry.ts`.
- Effective permission overrides in `permissions.ts`.
- Trusted actions and proposal queue in `broker.ts`.
- Security policy and sandbox policy in `cores/security.ts`.
- Secret references, redaction, and brokered use in `cores/secrets.ts`.
- Audit events in `audit.ts`.

Current enforcement state:

- Permission tiers are enforced at the Broker's Security Core gate (propose, approve, and execute) against the typed **Action Definition registry** (`src/core/actionRegistry.ts`): each actionType binds to an owner Core, permitted proposing apps, a single effect kind, allowed object/target types, a payload-field allowlist, an executor owner, governing capability labels, and risk/undo. Unknown actions, a spoofed app, a mismatched effect kind, a disallowed object/target type, an undeclared payload field, or a caller-asserted `readOnly` that disagrees with the definition all deny structurally; the governing label must additionally sit in a permitted effective tier. Executor registration is structural too — only an action whose definition declares an external executor may register one.
- Secrets values are encrypted at rest (PBKDF2 600k iterations, non-extractable AES-GCM key, per-value IV, idle auto-lock) and **AAD-bound to the secret id** (enc2 format) so a swapped ciphertext fails authentication rather than decrypting under foreign metadata; enc1/pre-encryption items migrate on unlock and partial unlocks are reported. Deletion is recoverable (an encrypted vault trash with token-gated purge). Brokered use is a real `secrets.use` proposal whose value only ever reaches a registered internal consumer.
- Redaction passes through one choke point (`redactText`) for proposals (summary, detail, effect payload, and executor input), audit rows, notifications, search snippets/labels, and AI context; the vault-aware scan only covers values decrypted in the current tab while unlocked.
- The Dev Core sandbox isolates via opaque-origin iframe + CSP network deny + Worker, with **verdict integrity**: the harness binds a private completion channel in a closure and stamps a per-run nonce, so artifact code cannot forge a successful run via `send('done')`, `postMessage`, or a re-acquired channel; async rejections fail the run. The forbidden-globals source scan remains advisory by design; installs remain user decisions gated on validation and a current successful run.
- Files Core's one-shot access grants separate minting from consumption: approval mints a revocable, expiring grant; `openFileWithGrant` (async) consumes it at read time (re-validating trash/source/readability) and releases the redacted metadata plus — for byte-backed files — the stored bytes and their content-detected MIME. The byte runtime replaced only the release step, as the contract promised.
- Installed Dev Core widget artifacts run on the desktop as `devwidget` tiles: an opaque-origin iframe (`sandbox="allow-scripts"`, srcdoc CSP `default-src 'none'` with inline/eval script only — network denied) whose only channel to the OS is a token-gated postMessage RPC. `handleWidgetRpc` fails closed (unknown artifact, not installed, unknown kind, undeclared manifest permission all refuse; refusals audited as `dev.widget.denied`), and success data passes through `redactText`. The request vocabulary is the fixed `WIDGET_RPC_KINDS` map (each kind bound to a required manifest permission).
- Apps' own direct writes through Core APIs are user actions and are not permission-gated; the capability tiers govern the AI path.

## Extension Points

| Extension Point | Location | Purpose |
|---|---|---|
| App registry entry | `src/core/appRegistry.ts` | Add app surfaces and capability manifests. |
| Tile registry/meta | `src/components/tiles/`, `src/core/tileMeta.ts` | Add tile presentations and desktop behavior. |
| devwidget tiles | Dev app "Place on desktop" → `DevWidgetTile` | Run installed generated widgets, sandboxed, on the desktop. |
| Core service module | `src/core/cores/` | Add reusable capability contracts when justified. |
| AI route rules | `src/core/cores/ai.ts`, `src/apps/platform/` | Route intents or models. |
| Dev artifacts | `src/core/cores/dev.ts` | Generated widget/app artifact lifecycle. |

## Generated Artifacts And Outputs

| Artifact | Created By | Location | Purpose |
|---|---|---|---|
| Production bundle | `npm run build` | `dist/` | Deployable static PWA assets. |
| Service worker precache behavior | `public/sw.js` | Browser cache | Offline shell runtime. |
| Dev artifacts | Dev Core | localStorage | Generated code/artifact records. |

`dist/` is build output and should not be treated as source.

## Build, Runtime, And Deployment Architecture

Local development:

```bash
npm install
npm run dev
```

Type checking:

```bash
npm run typecheck
```

Production build:

```bash
npm run build
```

Preview:

```bash
npm run preview
```

Runtime environment:

- Browser.
- Node 20.19+ for development/build (Node 22.12+ or 24 recommended).
- PWA-capable Chrome or compatible browser for install/offline shell behavior.

Deployment is static-site/PWA compatible; no backend is required in the current architecture.

## Error Handling And Failure Modes

Important failure modes include:

- localStorage quota exhaustion.
- Invalid persisted local state.
- Service worker cache mismatch.
- AI provider unavailable or inert.
- Forbidden or unapproved AI action.
- Secret redaction miss.
- Generated artifact sandbox escape or validation false positive.
- Multi-tab scheduler races.

The system should surface failures clearly and distinguish working behavior from planned scaffolds.

## Architectural Invariants

These must remain true unless intentionally changed through a project-level decision:

- Core app experience remains local-first and usable without cloud services.
- Apps should become surfaces over shared Cores, not private silos.
- `src/core/storage.ts` remains the persistence boundary for local key/value state.
- User-facing data mutations by AI must be proposal-governed or explicitly trusted.
- Raw secrets must not be exposed to AI or logs.
- The app registry remains the source of truth for installed app surfaces and capability manifests.
- The spatial shell remains a fixed operating surface, not a scrolling dashboard.
- Current architecture docs must describe current truth, not hoped-for future behavior.

## Known Tradeoffs And Constraints

| Tradeoff | Current Decision | Reason | Revisit When |
|---|---|---|---|
| Persistence backend | localStorage for key/value state; OPFS/IndexedDB for file bytes | Small, transparent key/value model; bytes moved behind their own seam | Larger scale, sync, or per-object-type transactional records require deepening the IndexedDB migration. |
| Model runtime | Opt-in dispatch to a user-configured OpenAI-compatible endpoint; rule-based assistant remains the default and the fallback | Governance first; inference only by explicit user configuration | Streaming, multi-turn memory, or additional provider protocols are wanted. |
| File bytes | OPFS-first byte store behind Files Core (`byteStore.ts`) | Real bytes without native FS coupling; one seam to re-host on Linux | File System Access picker, folders, external mounts. |
| Tests | Vitest + jsdom for the Core layer; Playwright + real Chromium for integration | jsdom cannot run the Dev sandbox iframe/Worker, multi-tab storage races, or the offline service worker — those three gaps are now covered by `e2e/`; UI/shell correctness otherwise still relies on typecheck/build and manual validation | Broader shell/component coverage is deliberately added. |
| Core registry | Inspectable, and its structural claims are contract-tested | Useful architectural map that cannot silently drift | New claims should stay enforced or be downgraded. |

## Current Configuration Snapshot

Authoritative source: `package.json`.

| Item | Value |
|---|---|
| Package name | `locus-os` |
| Version | `0.6.0` |
| Module type | ESM |
| Runtime deps | `react`, `react-dom` |
| Build command | `npm run build` |
| Typecheck command | `npm run typecheck` |
| Dev command | `npm run dev` |
| Test command | `npm test` (Vitest, jsdom, `vitest.config.ts`); `npm run test:e2e` (Playwright, real Chromium, `playwright.config.ts`) |

## When To Update This Document

Update this file when a change:

- Adds, removes, renames, or reorganizes a major subsystem.
- Changes Core boundaries, app registry behavior, tile architecture, persistence, AI, security, secrets, broker, build, runtime, or PWA behavior.
- Adds or removes a provider, external service, sync mechanism, native file capability, model runtime, or generated artifact format.
- Makes current statements materially inaccurate.

Usually do not update this file for:

- Copy edits.
- Small CSS adjustments.
- Localized component bug fixes.
- Changelog-only updates.
- Roadmap-only direction changes with no current architecture change.
