# Changelog

## 2026-08-01 — Agent: Claude Code (Claude)

Maintainer requested implementation of the next three development phases — the
roadmap's three "Planned Future Versions", delivered as `0.6.0` in three
commits on this branch. Sub-tasks were delegated to smaller-model subagents
per the maintainer's instruction, with design, review, security fixes, and
validation handled centrally. Validated after each phase and at the end:
`npm run typecheck` clean, `npm test` **497** passing (was 427; new suites
`byteStore.test.ts`, `modelRuntime.test.ts`, `assistant.test.ts` plus extended
files/media/dev suites), `npm run build` succeeds, `npm run test:e2e` **11**
passing in real Chromium (was 9; new `devwidget.spec.ts`).

### Changed

- **Phase 1 — Files, Media, And Real Local Bytes (M1 byte half).** New
  `src/core/byteStore.ts` platform seam (OPFS → IndexedDB → memory, chosen
  once per session; failure-honest errors). Files Core: `importFileBytes`
  (magic-number content detection decides kind; extension only as fallback),
  `readFileBytes`/`readFileBytesHead`, `hasStoredBytes`, `storedByteUsage`,
  byte manifest under `StoreKeys.fileBytes`; `openFileWithGrant` is now async
  and releases real bytes + content-detected MIME (the byte runtime replaced
  only the release step, as the grant contract promised); trash keeps bytes,
  token-gated `emptyTrash` (now async) purges them before deleting metadata.
  Media Core: `mediaMetaForStored`, `mediaUrlFor`/`releaseMediaUrl` (Blob-URL
  playback). Files app: real import/download/preview + byte-store error
  surfacing; Music tile plays byte-backed audio. Files Core registry status
  promoted to functional.
- **Phase 2 — Dev App And Generated Widget Runtime.** New Dev app
  (`src/apps/dev/`): artifact list, create, code editor with diff-first
  apply, validate, sandbox run + logs, install gates with reasons, rollback,
  remove, and Place-on-desktop for installed widgets. New `devwidget`
  TileKind bound via `tile.settings.artifactId`; `DevWidgetTile` mounts
  installed widget artifacts in an opaque-origin iframe (CSP
  `default-src 'none'`, inline/eval script only — network denied at runtime)
  whose only OS channel is a token-gated postMessage RPC. `handleWidgetRpc`
  fails closed against the fixed `WIDGET_RPC_KINDS` vocabulary + declared
  manifest permissions; denials audited (`dev.widget.denied`); success data
  redacted. Seed "Deadline widget" now renders real data once placed. Dev
  Core registry status promoted to functional. I found and fixed one real
  bug in review: the widget srcdoc CSP lacked `'unsafe-eval'`, which the
  bootstrap's `new Function` needs — caught by the new real-browser e2e spec.
- **Phase 3 — First Real Model Runtime (M5).** New `src/core/modelRuntime.ts`
  — the single provider-adapter module: OpenAI-compatible dispatch to a
  user-configured endpoint behind a fail-closed `canDispatch` gate (enabled +
  provider + valid endpoint + model; remote endpoints additionally require
  the Cloud provider setting AND an explicit data-leaves-device
  acknowledgment that resets on endpoint change). Refused dispatches never
  touch `fetch` (tested). API keys only via Secrets Core's brokered
  `secrets.use` (memory-only session arming, never persisted/logged). Every
  dispatch audited (`ai.dispatched` — never prompt/response/key).
  `interpretAsync` in `assistant.ts` adds the model path: strict allowlisted
  action parsing; model-proposed writes reuse the exact `proposeThroughCore`
  payloads of the rule-based branches (shared helpers, so the two paths
  cannot drift); rule-based `interpret()` unchanged as default and fallback,
  with honest `via` explanations. AI Control Center gains the Model runtime
  panel; Assistant Ask is async with a busy state. Routing rules are now
  consumed at dispatch (modelHint override; local-route vs remote-endpoint
  refusal).
- **Docs.** `architecture.md`, `AGENTS.md` gotchas, `README.md`,
  `productRoadmap.md` (three future versions moved to a "Delivered" section
  with honest not-shipped lists; open questions 2 and 3 resolved; version
  bumped to `0.6.0` in `package.json`).

### Not completed

- File System Access picker, folder/external mounts, IndexedDB handle
  persistence, Viewer/Screen surfaces, thumbnails, and per-object-type
  IndexedDB transactional records (the remaining M1 half).
- Widget write-path RPC (proposal-routed), typecheck/lint runners,
  dependency bundling for Dev Core.
- Model runtime: streaming, multi-turn memory; a model-suggested reminder
  time is recorded in the proposal detail but Time Core still schedules
  "tomorrow 9:00" like the rule-based path.
- `storage.exportAll()` does not include byte payloads (per-file Download in
  the Files app is the byte export path; documented in architecture.md).
  `byteStore.clearAllBytes()` exists but is not yet wired into the Safe-mode
  full-reset flow.

### Notes

- Validation: typecheck, 497 unit tests, build, and the 11-test Playwright
  suite all pass locally. No manual browser smoke of the new surfaces (Dev
  app, Model runtime panel, Files import) was performed in this headless
  environment beyond the real-browser e2e coverage; dark/light theming of
  new UI follows tokens but was not eyeballed. No live model endpoint was
  exercised — unit tests stub `fetch`, so real Ollama/LM Studio/provider
  compatibility is unverified against an actual server.
- Portability: no new dependencies; `byteStore.ts` and `modelRuntime.ts` are
  named platform seams per `locus-platform-portability`; browser-only Blob
  URL behavior is confined to Media Core and documented as such.

### Handover

- Next agent should start with: wiring `byteStore.clearAllBytes()` into the
  Safe-mode/Settings full-reset flow, then a live-endpoint smoke of the model
  runtime (Ollama at `http://localhost:11434` is the expected first target),
  then the remaining M1 half (per-object-type IndexedDB transactional
  records).
- Open questions: next version theme (roadmap Q1); whether a model-suggested
  reminder time should be honored by Time Core's scheduler.
- Risks or assumptions: OPFS availability varies by browser/context — the
  IndexedDB fallback is tested, but a real-device OPFS pass has not been
  done; the devwidget CSP relies on srcdoc `<meta>` CSP semantics, which the
  e2e suite verifies in Chromium only.

## 2026-07-11 — Agent: Claude Code (Claude)

Core System completion pass: closed every deferred stabilization item from
`development-docs/coreSystemStatus-2026-07-11.md` (Waves 1–4). Validated:
`npm run typecheck` clean, `npm test` **427** passing (was 375; added
`storage.test.ts` and cases across security/broker/cardspoke/editor/files/
search/people/monitor/secrets/notification/media/time/registry), `npm run build`
succeeds, `npm audit --omit=dev` reports **0** production vulnerabilities, and a
new **Playwright real-browser suite** (`npm run test:e2e`, 9 tests) passes —
covering the Dev sandbox iframe/Worker, multi-tab storage races, and the offline
service worker that jsdom could never exercise.

### Changed

- **Wave 1 — Action Definition registry (`actionRegistry.ts`, `security.ts`,
  `broker.ts`, `ai.ts`, `appRegistry.ts`).** New typed registry binds each
  actionType to its owner Core, permitted apps, effect kind, object/target
  types, payload-field allowlist, executor owner, governing labels, and
  risk/undo. `authorizeProposal` is now structural + fail-closed: unknown
  actions, a spoofed proposing app, a mismatched effect kind, a disallowed
  object/target type, an undeclared payload field, or a caller-asserted
  `readOnly` that disagrees with the definition all deny. Executor registration
  is registry-gated. AI Core derives the verified `originCore` from the registry
  and matches routing keywords at word boundaries.
- **Wave 1 — every AI write through AI Core.** Editor, Files, and Web AI-write
  paths route through `proposeThroughCore` (Monitor and Secrets too, added in
  Wave 3); the rule-based assistant re-checks the context packet's scoped-app
  set before its Time/People/Tasks read branches answer.
- **Wave 2 — durable persistence (`storage.ts`, `main.tsx`, `SafeMode.tsx`).**
  Write-behind **IndexedDB durable mirror** with a monotonic per-key revision;
  boot `hydrateDurable()` restores keys localStorage lost (cleared, evicted, or
  a quota-failed write only the mirror captured) before seeding. `storage.update()`
  is a cross-tab-locked (Web Locks + in-tab queue) transactional read-modify-write;
  the Broker lifecycle is rebuilt on it (async, no double-execute across tabs).
  `storage.get()` returns a stable per-key reference even for absent/invalid keys.
  New root **Safe mode** error boundary + boot-failure surface (export, per-store
  reset, retry).
- **Wave 3 — per-Core hardening.** Time: durable dispatch outbox (ack/retry/
  dead-letter), explicit DST gap/fold policy, recurring missed-outcome. Cardspoke:
  recoverable object trash + token-gated purge, backlink/wiki-link symmetry.
  Editor: monotonic `rev` version token (same-ms edits caught). Files: grant
  mint-vs-consume split (`openFileWithGrant`), token-gated empty-trash. Search:
  exclusion provenance (user/source-pattern/trash), `retrieveForAI`/
  `relationshipsForAI` redacted DTO path. People: typed person↔object relationship
  table + daily birthday reconciliation past the boot horizon. Monitor: brokered
  `monitor.createWatch`, async webpage cooldown/escalation/recovery state. Web:
  manifest label reconciled, captured page-context feeds the AI packet.
  Secrets: AES-GCM **AAD-bound to the secret id**, recoverable delete (encrypted
  vault trash), real `secrets.use` broker path delivering the value only to a
  registered internal consumer. Notification: policy-hold vs user-snooze fields,
  pending-vs-history eviction (read history only). Media: byte-backed magic-number
  detection seam. Dev: sandbox **verdict integrity** (private completion channel
  + per-run nonce) so artifact code cannot forge a successful run.
- **Wave 4 — real-browser tests + CI (`e2e/`, `playwright.config.ts`, `sw.js`,
  `vite.config.ts`, `.github/workflows/`).** Playwright suite for the three
  jsdom gaps; a Vite plugin injects the built asset list into the service worker
  so the FIRST launch is offline-capable (SW cache matching uses ignoreVary/
  ignoreSearch). CI and the Pages deploy both run the e2e suite.
- **Docs.** `architecture.md`, `README.md`, `AGENTS.md` gotchas, `productRoadmap.md`,
  and the Core registry updated to describe the new enforced behavior; new status
  report `development-docs/coreSystemStatus-2026-07-11-completion.md`.

### Not completed

- **Next-version scope, not this pass:** IndexedDB per-object-type transactional
  records (the durable mirror is a recovery/quota layer over the same key/value
  model, not per-record transactions yet), OPFS/native file bytes, a real model
  runtime, and an installed generated-widget runtime. These are the M1+ items in
  `productRoadmap.md`, not stabilization blockers.

### Notes

- Validation: `npm run typecheck`, `npm test` (427), `npm run build`,
  `npm audit --omit=dev` (0 prod vulns), and `npm run test:e2e` (9 Playwright
  tests in real Chromium) all pass. The e2e suite caught a genuine latent bug:
  the Broker/Secrets rewrites dropped the stable-reference module caches, so
  `storage.get(key, [])` handed `useSyncExternalStore` a fresh `[]` each render
  and crashed the production app into an infinite re-render loop — fixed at the
  storage layer (stable per-key fallback) with a regression test.
- New dev dependencies: `@playwright/test` and `fake-indexeddb` (both Node/
  browser-runtime, no hidden network); flagged for portability review.

### Handover

- Next agent should start with: the M1 storage migration — promote the durable
  mirror from a key/value recovery layer to per-object-type IndexedDB
  transactional records, then OPFS byte storage (Files Core), per
  `linuxIntegrationPlan.md`.
- Open questions: whether to wire a first model runtime now that the proposal/
  redaction/permission/audit path is structurally enforced (roadmap Q3).
- Risks or assumptions: the Playwright suite pins the environment's provisioned
  Chromium locally and uses a managed browser on CI; `sw.js` precache injection
  assumes the Vite emitted-asset names (JS/CSS) — verify after any build-tool
  change.

---

## 2026-07-11 — Agent: Claude Code (Claude)

Core System + Core-by-Core stabilization pass resolving the findings in
`locus-os-core-system-audit-2026-07-10.md`, plus an independent follow-up audit.
All work validated: `npm run typecheck` clean, `npm test` 373 passing (was 357;
added `broker.test.ts`, `registry.test.ts`, and cases across security/cardspoke/
files/people/web/dev), `npm run build` succeeds, `npm audit --omit=dev` reports
0 production vulnerabilities.

### Changed

- **Persistence & boot (`storage.ts`, `scheduler.ts`, `main.tsx`, `audit.ts`).**
  `exportAll()` now overlays in-memory `unpersisted` writes and lists
  `memoryOnlyKeys`, so a quota-failure recovery export contains the newest
  unsaved data. `get<T>()` takes an optional runtime `validate` guard (invalid
  *shape*, not just invalid JSON, is preserved under the backup key). A cross-tab
  write clears the stale `unpersisted` entry. The storage-failure listener is
  registered before any seeding/Core init so boot-time failures reach the user.
  Scheduler lease write returns a boolean; a blocked write degrades to running
  the job locally instead of electing nobody. Time Core's scheduler now inits
  last, after every onTimeFire/registerScheduledJob consumer, so a cold-boot
  due entry can't fire before its consumer registers. Audit header downgraded
  from "append-only" to honest "bounded retention".
- **Security Core + Broker (`security.ts`, `broker.ts`, `types/ai.ts`).**
  `authorizeProposal` is fail-closed: a write or external effect (read-only
  external included — it is still egress) from an app with no capability
  manifest is denied; read-only external is capability-checked via governing
  labels. `trustedTierPermits` gates auto-run on the capability actually sitting
  in the Trusted tier. Broker redacts the effect *payload* (title/body/tags +
  externalSummary), not just summary/detail; re-reads fresh before approve/
  execute (shrinks the two-tab double-execute window); rejects duplicate
  executor registration (once-only owner); and external executors are now typed
  (`ExecutorOutcome`) and async-aware — a proposal goes `executing` and settles
  `executed`/`failed` on the real outcome instead of being reported done at
  dispatch. Added a `broker.test.ts` (the Broker had no suite).
- **AI read policy (`aiContext.ts`, `assistant.ts`, `people.ts`).** The context
  packet excludes AI-hidden tiles even when a persisted scope names them, filters
  surfaced objects by index-exclusion / source-readability / trash, and scopes
  recent activity to in-scope apps. People's `contactForAI` no longer leaks the
  birthday (a sensitive field with no readable capability).
- **AI Core (`ai.ts`).** `proposeThroughCore` verifies routing against an
  action→owner map and persists a verified `originCore`; routing rule enable/
  disable/remove are audited.
- **Cardspoke + object store (`cardspoke.ts`, `objects.ts`, `types/objects.ts`).**
  `updateCard`/`deleteCard`/`convertCard` guard ownership (Cardspoke-owned types
  only) so a File can't be hard-deleted or converted through them.
  `convertObjectType` keeps a per-type `previousShapes` map, so a
  task→card→document→task round trip is lossless.
- **Editor Core (`editor.ts`).** Proposing app is derived from the target type
  (caller can't spoof it) and unsupported targets are rejected; a title change
  is surfaced in the preview; a Security-denied proposal is no longer logged as
  "proposed".
- **Files Core (`files.ts`).** Trash is `deletedAt`-only (a plain `trash` tag is
  no longer lifecycle state that `emptyTrash` could permanently delete); a
  one-time boot migration moves legacy tag-trashed files to `deletedAt`. Access
  requests and `fileMetaForAI` enforce source readability; the executor is typed
  and re-validates, consumes the exact minted grant, and a revoke path exists.
- **Search/Index (`searchIndex.ts`, `indexing.ts`, `sources.ts`).** Exclusions
  apply at query time (a just-added exclusion takes effect immediately) via a
  normalized glob matcher; `runIndex` no longer revives trashed or explicitly
  excluded objects; AI retrieval gates on source readability; date filters
  validate real calendar dates.
- **Web Core (`web.ts`).** A strict AI-fetch normalizer (https-only, reject URL
  userinfo, block private/loopback/link-local hosts — SSRF guard) plus
  credentials-omit / no-referrer / no-store fetch, redirect-destination
  re-check, MIME + size cap; the capture executor is awaited and typed.
- **Secrets Core (`secrets.ts`).** Undecodable legacy base64 is preserved, not
  overwritten with an encryption of `""`; `revealSecret` refuses stale plaintext
  after a cross-tab rotation (ciphertext-bound cache).
- **Notification (`notification.ts`, `notifications.ts`).** Mutators re-read
  before writing so a stale cache can't clobber a newer inbox; malformed policy
  is coerced so `deliver` can't throw; source/action labels are redacted. Time
  alarms are `critical` so quiet hours no longer suppress them.
- **Monitor (`monitor.ts`).** Per-watch `try/catch` isolates a malformed watch;
  history is redacted before persistence; the evaluator re-reads fresh and keeps
  its cache warm; a direct `createWatch({createdBy:"ai"})` is refused (AI must
  propose); reachability fetch is credential-free.
- **Media (`media.ts`).** Extension parsing strips query/hash; SVG/AVIF are no
  longer claimed universally renderable; AI-facing titles are redacted and gated
  on source readability; the `canPlayType` probe is cached.
- **Events.** Cores that emit a rich typed payload now pass `skipEmit: true` to
  their `record()` call, so a single event fires with one shape instead of two.
- **PWA/CI/deps/docs.** `public/sw.js` deletes only Locus-prefixed caches
  (never another project's on a shared origin) and guards the nav-shell cache
  write. New `.github/workflows/ci.yml` runs typecheck+test+build+prod-audit on
  PRs; the Pages deploy is gated on typecheck+test. Vite 6.4.x (clears the dev
  advisory; 0 prod vulns) and `engines.node >=20.19`. Corrected the version
  display (0.2.0→0.5.0), the Node baseline, the "no test script" and Trusted
  claims, and the enforcement/encryption honesty in architecture/roadmap.
- Added `development-docs/coreSystemStatus-2026-07-11.md`: the detailed Core
  System status report requested with this pass.

### Not completed

- Deferred (documented in the status report as remaining stabilization work):
  full IndexedDB transactional persistence + Web Locks (only re-read-before-write
  mitigations landed); a typed Action Definition registry binding action↔owner/
  effect/object/executor (enforcement is fail-closed but still label-matched);
  Secrets AAD binding and recoverable delete; Dev sandbox forged-completion
  isolation and the real-browser (Playwright) adversarial suite; a build-time
  service-worker precache manifest for guaranteed first-launch offline; and the
  assistant's direct read branches still query some Cores without re-checking
  scope (the assembled context packet does enforce it).

### Notes

- Validation: typecheck + full Vitest suite (373) + production build + prod
  dependency audit all run and pass; multi-tab/service-worker/real-browser
  behaviors remain unverifiable in jsdom and are called out honestly.
- Findings were re-verified against the current tree before acting — several
  audit items were already partially fixed (e.g. Broker update field-wipe,
  `previousShape` snapshotting, `createTimeEntry` targetCore/payload), and one
  agent-reported "critical" (dropped targetCore) was stale and not applied.
- An adversarial self-review of the diff caught one regression I introduced —
  `isPrivateHost` misclassified public domains starting with `fc`/`fd`/`fe80`
  (fcc.gov, fda.gov) as private — which is fixed and guarded by tests; it also
  prompted the interrupted-proposal boot sweep (`recoverDanglingProposals`).

### Handover

- Next agent should start with `development-docs/coreSystemStatus-2026-07-11.md`
  (Wave-1/Wave-2 items) then `AGENTS.md`.
- Open questions: whether to adopt a typed Action Definition registry now (the
  single highest-leverage remaining item) vs. after IndexedDB persistence.
- Risks/assumptions: the fail-closed Security change denies writes/external
  effects from apps with no manifest — verified against all current proposal
  sites, but any new proposal must come from a registered app with the right
  tier.

## 2026-07-10 - Agent: Claude Code (Claude)

### Changed
- Recorded the maintainer-declared long-term platform direction: Locus OS is eventually to become the shell/service layer of a Linux-based OS developed against `jxburros/locus-linux` (wrapper-first — pristine upstream kernel + Locus userspace — with a kernel fork only on demonstrated need).
- Added `development-docs/linuxIntegrationPlan.md`: canonical integration plan — state assessments of both repos, two-stage target architecture (kiosk image, then native Core services via a `locus-cored` daemon), concept translation map, phase gates M0–M6 with exit criteria, per-repo readiness workstreams, risks, and open maintainer decisions.
- Added four repo-local skills under `skills/`: `locus-platform-portability` (layering rules, named platform seams, IPC-survivable Core contracts), `locus-linux-translation` (per-concept web→Linux mapping and decision guide), `locus-shell-design-language` (hard design rules + section index into `design.md`), and `locus-validation-loop` (validation matrix per change type, Core test conventions, honest reporting).
- `AGENTS.md`: added `linuxIntegrationPlan.md` to required documentation access and a "Locus Skills (`skills/`)" section listing the new skills with triggers. `CLAUDE.md`: added a Task-Matched Skills section.
- `productRoadmap.md`: added the "Long-Term Platform Direction: Locus OS On Linux" section (declared direction, phase-gated; current version focus unchanged); pointed the deferred platform-expansion item at the plan; corrected two stale statements (secrets are now encrypted at rest per the 2026-07-04 stabilization pass, and Vitest exists but CI does not run tests); bumped the review date.
- `README.md`: governance section now mentions the `skills/` directory and the Linux direction/plan doc.
- Sibling repo `jxburros/locus-linux` (same branch): added root `AGENTS.md` and `CLAUDE.md`, `locus/README.md`, `locus/docs/readiness-plan.md`, `locus/CHANGELOG.md`, and skills `locus/skills/locus-kernel-fork-hygiene` and `locus/skills/locus-image-boot` — establishing fork-hygiene policy while the tree is still pristine upstream Linux v7.2-rc2.

### Not completed
- No code behavior changed; all phases M1+ of the integration plan are plans, not implementations.
- Open maintainer decisions listed in `linuxIntegrationPlan.md` §10 (LTS base, image builder, `locus-cored` placement, hardware target, M1 promotion timing, naming).

### Notes
- Validation: documentation/skills-only change; `npm run typecheck` and `npm test` not required (no TS touched). Repo state was assessed from source (registry, cores, broker, storage, tests, CI workflow) rather than from prior analysis docs alone.
- locus-linux was verified to be a pristine upstream mirror (no Locus-specific commits or files) before writing its governance.

### Handover
- Next agent should start with: `AGENTS.md`, then `development-docs/linuxIntegrationPlan.md` for anything platform-related; ordinary work continues under the Core Stabilization focus.
- Open questions: the §10 maintainer decisions above; whether to add `npm test`/typecheck to CI (recommended in the plan and the validation skill).
- Risks or assumptions: the plan assumes the browser form remains first-class through every phase; phase gates assume Core Stabilization completes before M1 begins.

## 2026-07-04 - Agent: GitHub Copilot (Claude Sonnet)

### Changed
- Updated `AGENTS.md`: added Section 2 "Required Skill" pointing to `skills/spec-driven-development /SKILL.md`; added `development-docs/design.md` to Section 3 (Required Documentation Access) for UX/UI and visual decisions; renumbered former sections 2–17 to 3–18.
- Updated `CLAUDE.md`: added "Required Skill" section referencing the `spec-driven-development` skill; added `development-docs/design.md` as item 6 in Required Reading for UX/UI and visual decisions.
- Updated `.github/copilot-instructions.md`: added "Required Skill" section instructing Copilot to invoke the `spec-driven-development` skill; added `development-docs/design.md` to Required Context for UX/UI and visual decisions.

### Not completed
- None.

### Notes
- Validation: documentation-only change; no code altered; `npm run typecheck` / `npm run build` not required.
- `development-docs/design.md` already exists in the repo; no new file was created.

### Handover
- Next agent should start with: `AGENTS.md` Section 2 (invoke skill), then `development-docs/coreIdentity.md`.
- Open questions: None introduced by this change.
- Risks or assumptions: None.

## 2026-07-05 - Agent: Claude Code (Claude) (CI: make GitHub Pages deploy resilient to backend flakes)

### Changed
- **`.github/workflows/pages.yml` — the `deploy` job now retries.** Diagnosis: the `build` job has always succeeded; the intermittent failures were all in the separate `deploy` job, where `actions/deploy-pages@v4` created the deployment and then got a terminal `Deployment failed, try again later.` back from GitHub's Pages backend within ~5 seconds. This is GitHub's own retry-me signal, not a problem with the built site (`dist/` builds and uploads cleanly every run) — it clustered around closely-spaced pushes to `main` (e.g. a push at 19:49:32 deployed fine, the next at 19:49:48 failed 16s later), with the occasional isolated flake. The workflow had no retry, so a single backend hiccup failed the whole run. Fixed by attempting the deploy up to three times (45s then 90s pause between attempts); the first two attempts use `continue-on-error`, so the job only fails if the third also fails. Also set each attempt's `timeout` to the action's real maximum (`600000` ms) instead of `1200000`, which GitHub was silently clamping while emitting a warning.

### Notes
- Behavior-preserving for the happy path: when the first attempt succeeds (the common case), the retry steps are skipped and the run is identical to before. No application code, build config, or Pages source setting was changed.
- This mitigates GitHub-side backend flakiness; it cannot guarantee the backend never rejects all three attempts. If deploys start failing on all attempts, that points to a real problem (e.g. Pages source no longer set to "GitHub Actions", or an artifact issue) rather than a transient flake.

## 2026-07-05 - Agent: Claude Code (Claude) (Core Services layer: test infrastructure + full review)

### Changed
- **Added Vitest as the project's test runner** (`vitest`, `jsdom` devDependencies; `vitest.config.ts`; `npm test` / `npm run test:watch` scripts). None existed before — `developmentManifesto.md`'s open maintainer question ("whether a formal test runner should be added now") is resolved by this pass and the question is removed. Tests run against real `src/core/storage.ts` (jsdom's `localStorage`), not a mock, so they exercise the same code path the browser does.
- **Reviewed every one of the fourteen Cores individually** (`src/core/cores/*.ts`) for correctness, and added a regression suite for each: `security.test.ts`, `time.test.ts`, `notification.test.ts`, `secrets.test.ts`, `editor.test.ts`, `cardspoke.test.ts`, `people.test.ts`, `ai.test.ts`, `files.test.ts`, `monitor.test.ts`, `media.test.ts`, `web.test.ts`, `dev.test.ts`, `searchIndex.test.ts` — 357 tests total, reviewed in dependency order (foundational Cores first) so each Core's tests could rely on already-verified dependencies.
- **Fixed real bugs found during the review:**
  1. **Circular-import fragility (`dev.ts` ↔ `security.ts`):** `dev.ts` read `SANDBOX_POLICY.forbiddenGlobals` at module top-level; depending on which module the app happens to import first, `security.ts` can still be mid-initialization when `dev.ts`'s top-level code runs, throwing `TypeError: Cannot read properties of undefined`. Caught by the *first* test written (`security.test.ts`), which imports `security.ts` directly and hit the crash immediately. Fixed by deferring the read into a memoized `identGlobals()` helper called only from `validateArtifact` (i.e., after boot).
  2. **Cardspoke Core's inline-tag cap (`extractInlineTags`):** capped the raw `#tag` regex matches at 5 *before* case-insensitive dedup, so a same-tag case collision within the first 5 matches (e.g. `#a #A #b #c #d #e`) silently dropped a later distinct tag, yielding fewer than 5 tags even when 5+ unique tags were present. Fixed to dedupe while scanning and stop once 5 *unique* tags are collected.
  3. **Media Core's extension parsing (`extOf`):** used `name.split(".").pop()`, so a name with *no* dot returned the whole string as its "extension" — a file titled exactly `"png"` or `"mp4"` (no dot) was falsely recognized as an image/video. Fixed to return `""` when there is no dot.
  4. **Files Core's `consumeFileGrant`:** called `Date.now()` twice (once for the persisted grant, once for the returned one), so the returned grant's `usedAt` could differ by a millisecond from what was actually stored. Now captures one timestamp and reuses it for both.
- No other Core (Time, Notification, Secrets, Editor, People, AI, Monitor, Web, Search/Index) turned up a functional bug under review — Security Core's `authorizeProposal`/`evaluateManifest`, People Core's birthday-anchor/recurrence math, and Monitor Core's edge-triggered alert/escalation/cooldown state machine in particular held up under fairly adversarial test construction.
- Docs updated for the new test runner: `README.md` (`npm test` / `npm run test:watch` mentioned alongside the other scripts), `developmentManifesto.md` (Testing section describes Vitest + jsdom and where suites live; the "should a test runner be added" open question removed since this pass answers it), `architecture.md` (the `Tests` row in Known Tradeoffs, a `Test command` row in the Configuration Snapshot, and `vitest.config.ts` in the directory map).

### Not completed
- Test coverage is scoped to the Core Services layer (`src/core/cores/`) only, per the task's own framing — the spatial shell, tile/desktop components, and app surfaces (`src/apps/`, `src/components/`) have no automated tests yet and still rely on typecheck/build/manual verification.
- Dev Core's `runInSandbox` real iframe+Worker execution path cannot be meaningfully exercised by jsdom (no real script/Worker execution inside a sandboxed iframe) — its test coverage is limited to the guard clauses (missing/unvalidated artifact) and the timeout path; a passing sandbox run can only be produced by a real browser, so `canInstall`'s "successful run" branch is asserted by its honest refusal reason rather than driven end-to-end in this suite.
- No UI/app-surface changes were made — this was a Core-layer correctness and test pass, not a feature or wiring change.

### Notes
- Validation: `npm run typecheck` and `npm run build` clean throughout. `npm test` run repeatedly (multiple full-suite passes) with 357/357 passing and no flakiness after fixing two test-only timing issues (see below) — none in application code.
- Two of my own tests were initially flaky/wrong, not app bugs: (a) a couple of tests created two objects and mutated one synchronously with real timers, relying on `updatedAt` ordering that isn't guaranteed when both calls land in the same millisecond — fixed by using `vi.useFakeTimers()`/`vi.advanceTimersByTime()` between operations; (b) a recency-ranking test in `searchIndex.test.ts` had its own arithmetic wrong about which document was inside the one-week recency-boost window. Both are noted inline in the test files where they occurred.
- Each Core's tests use a `vi.resetModules()` + dynamic re-import pattern per test (rather than a shared top-level import) because most Cores keep a module-level in-memory cache (e.g. `time.ts`'s `cache`, `notifications.ts`'s `cache`) that a real single-session SPA never needs to reset between unrelated units of work — this gives full isolation between tests without touching any private API.

### Handover
- Next agent should start with: `AGENTS.md`, then this entry, then `npm test` to confirm the baseline is still green before further changes.
- Open questions: whether app-surface (shell/tile/component) test coverage should be added next, and with what tooling (React Testing Library would be the natural pairing with the Vitest+jsdom setup already in place) — left for explicit maintainer direction per the "smallest safe change" scope of this pass.
- Risks or assumptions: the four fixes above are behavior-preserving in the common case (correct extensioned filenames, distinct-case tags, non-colliding grant timestamps) and only change output for the narrow edge cases described — no existing passing behavior was altered. The circular-import fix (dev.ts) removes a genuine crash risk that depends on import order elsewhere in the app; I did not audit every other Core for the same top-level-read-across-a-cycle pattern beyond what surfaced during testing, so a similar latent issue could in principle exist elsewhere in the broader `src/core/` tree outside the fourteen Core modules.

## 2026-07-05 - Agent: Claude Code (Claude) (follow-up: enforcement coverage + grant consumption)

### Changed
- **Full per-label coverage for `editor.applyTransaction`:** the actionType was ambiguous for Cards and Tasks (Editor Core's `proposeEditTransaction` routes it to whichever app owns the target object type, but neither manifest had a label naming "edit the object's body"). Rather than guess an existing label, `appRegistry.ts` now declares one for each ("Edit a card's body via an approved proposal", "Edit a task's body via an approved proposal"), and `security.ts`'s `ACTION_LABELS` table maps `editor.applyTransaction` for all four apps it can route to (writer, cards, tasks, assistant — assistant already had one unambiguous label, "Create or edit objects via an approved proposal"). Every actionType with a real proposal call site in the codebase is now per-label enforced; only future, not-yet-added actionTypes fall back to tier-level.
- **Grant consumption wired:** Files Core's one-shot `FileAccessGrant` was minted on approval but never consumed (`consumeFileGrant` had zero callers) — grants piled up forever with no reader. Since there is no real byte-reading runtime yet (bytes are out of scope per architecture.md), the honest fix is at the boundary that exists today: `initFilesCore`'s `files.access` executor now consumes the grant immediately after minting it and returns the file's redacted metadata (`fileMetaForAI`) as the release, visible in the existing Audit Log as the `ai.executed` record's detail. A future byte-reading runtime would consume grants lazily, at actual open time, instead of at mint time — documented as such in `files.ts`.
- Registry (`src/core/cores/registry.ts`), `architecture.md`, and `AGENTS.md` updated to describe both as complete rather than open gaps.

### Not completed
- No app-facing UI was added for either change, at the requester's explicit direction — this pass is Core/security-layer wiring only. A UI to inspect/revoke file grants, or to edit a card/task body through an AI-proposed transaction, remains an app surface's job if wanted later.
- Dev Core's artifact-creation/code-editing surface and cross-tab last-writer-wins remain as previously documented — not touched this pass.

### Notes
- Validation: `npm run typecheck` and `npm run build` clean. Verified the grant-consumption path end-to-end against the actual built app: temporarily exposed `requestFileAccess`/`approve`/`listFileGrants` on `window` in `main.tsx`, drove `requestFileAccess → approve` in a real browser session via Playwright, confirmed the grant's `usedAt` was set immediately and the audit log recorded `"Grant ... consumed — cover-draft.png — image, 1126 KB"`, then reverted the temporary `main.tsx` exposure (not part of the shipped diff — `git diff src/main.tsx` is empty). The per-label extension for `editor.applyTransaction` reuses the same `authorizeProposal` branch already verified in the prior entry; only new table rows and manifest strings were added, and the full project typecheck/build cover it, but I did not additionally unit-drive a refusal case in the browser this pass.

### Handover
- Next agent should start with: `AGENTS.md`, then this entry.
- Open questions: none new — the "not completed" list is now down to Dev Core's artifact-creation UI and the cross-tab tradeoff, both previously flagged as deliberately out of scope.
- Risks or assumptions: the new manifest labels ("Edit a card's/task's body via an approved proposal") default into `writableWithApproval`, matching the behavior that already existed under the tier-level fallback (any write label present already allowed `editor.applyTransaction`) — so default behavior is unchanged for users who have not customized permissions. The change is a *tightening*, not a broadening: a user can now block AI-proposed card/task body edits specifically by removing just that one label, instead of having to empty every write label for the app (which previously would have also blocked `cards.create`/`tasks.create`).

## 2026-07-05 - Agent: Claude Code (Claude)

### Changed
- **Per-label capability enforcement:** `authorizeProposal` (`src/core/cores/security.ts`) now checks the *specific* manifest label governing a write, not just tier counts, for every `(app, actionType)` pair with an unambiguous label in the new `ACTION_LABELS` table (`tasks.create`, `cards.create`, `time.reminder`, `files.index`, `writer.preview`, `editor.applyTransaction` for Writer). A mapped write is refused unless its governing label sits in `writableWithApproval`/`trusted`, and refused outright if the label sits in `forbidden`. `(app, actionType)` pairs with no unambiguous label (e.g. `editor.applyTransaction` routed to Cards/Tasks, where no single manifest label matches a free-text body edit) are left on the prior tier-level check by design — guessing a label would let enforcement silently refuse or silently allow the wrong thing.
- **Saved filters wired:** Tasks now has a tag filter box, a "Save filter" button, and a saved-filters row (apply/remove) backed by Cardspoke Core's `listSavedFilters`/`saveFilter`/`removeSavedFilter`/`subscribeSavedFilters` — previously zero callers.
- **Outline → tasks wired:** Cards shows a "→ Tasks (outline)" button whenever the selected card's body has bullet/checklist lines, calling `convertOutlineToTasks` (idempotent, previously zero callers).
- **Durable trigger payload routing wired:** birthday reminders (`scheduleBirthdayReminder` in `src/core/cores/people.ts`) now carry `targetCore: "people"` and `payload: { contactId }`; People Core registers the first real `onTimeFire` consumer (`registerTriggerConsumer`, guarded to register once) that reacts with a People-Core-specific audit line naming the contact, instead of the generic Time Core firing record only.
- **Dev Core artifact inspector:** the Cores app (`src/apps/cores/Cores.tsx`) gained a "Dev Core artifacts" panel — select an artifact, then Validate, Run in sandbox, Install/Uninstall, Rollback to a prior version, or Remove, all through the existing Dev Core gate (`canInstall` still refuses install until validation passes and the current code has a successful sandbox run). Verified end-to-end in the built app: validate → run in sandbox → install (status flips to installed, notification delivered) → uninstall.
- Registry (`src/core/cores/registry.ts`), `architecture.md`, and `AGENTS.md`'s Known Gotchas updated to describe the above honestly (per-label vs. tier-level split, which surfaces are wired, what in Dev Core still has no UI).

### Not completed
- Per-label enforcement does not cover every actionType — only the ones with one unambiguous governing label. Extending coverage requires either accepting a fragile prose match or introducing stable machine ids alongside manifest prose (a larger, deliberately out-of-scope manifest-shape change).
- Dev Core still has no UI for artifact *creation* or code editing (`createArtifact`, `updateArtifactCode`, `diffArtifact`, `artifactForAI` remain caller-less outside the AI/broker path) — the inspector operates on the seeded/existing artifact, not new ones.
- Grant consumption (Files Core's brokered-access grants) remains unwired — out of scope for this pass, not touched.
- Cross-tab whole-array last-writer-wins remains the accepted tradeoff noted in the prior entry; not touched.

### Notes
- Validation: `npm install`, `npm run typecheck`, `npm run build` all clean. Manual Playwright smoke test against the production preview: dismissed onboarding, opened Tasks/Cards/Cores with no console errors; saved a tag filter and re-applied it; converted a two-line bullet body into two real tasks; and ran the full Dev Core pipeline (validate → sandbox run → install → uninstall) on the seeded "Deadline widget" artifact, confirming status transitions and the install notification.

### Handover
- Next agent should start with: `AGENTS.md`, then this entry.
- Open questions: whether per-label enforcement should be extended by adding stable machine-readable label ids to manifests (would unblock ambiguous actionTypes like `editor.applyTransaction` for Cards/Tasks); whether Dev Core needs an artifact-creation/editing surface next, or whether artifact creation should stay AI/broker-only.
- Risks or assumptions: the People Core trigger consumer only reacts to entries it created itself (`targetCore: "people"`); it does not retroactively apply to any pre-existing birthday reminders created before this change (they still fire, just without payload routing, until they next reschedule).

## 2026-07-04 - Agent: Claude Code (Claude)

### Changed
- Core system review-and-stabilization pass: four parallel audits over the Core infrastructure, all fourteen Core modules, and app-to-Core wiring; every confirmed defect fixed or honestly documented.
- **Enforcement (was display-only):** `authorizeProposal` now receives the proposing app's *effective* capability tiers and refuses write effects when the user has emptied the app's write tiers, and delete effects when the app's effective `forbidden` tier bans deletion. The broker re-runs the gate at approve and execute (covers the trusted auto-run path), so stale verdicts can no longer execute. Verified end-to-end in the built app (refusal recorded, nothing created).
- **Storage honesty:** corrupt values are preserved under a `corrupt:` backup key instead of silently becoming "empty" and being overwritten; quota/write failures keep the session consistent in memory, notify subscribers, and surface one critical notification per failure kind; `storage.get` caches parsed snapshots by raw string (fixes the `useSyncExternalStore` fresh-reference contract violation for object-valued keys); `clearAll` notifies per-key subscribers and `"*"` exactly once.
- **Data export:** `storage.exportAll()` + Settings → Storage → "Export all data" downloads every Locus key as one JSON file and records `data.exported` — the seeded "take your data and leave" promise is now real. The reset path no longer mislabels itself as an export.
- **Redaction choke points closed:** every audit row (`record`) and every notification (`deliver`) now passes through Secrets Core redaction (injected registration avoids import cycles); AI-context people and vault-ref lines redact too. A key pasted into a task title can no longer reach the log, the shade, or AI context.
- **Time Core recurrence corrected:** recurring entries carry an `anchorAt` grid anchor, so a monthly 31st clamps to Feb 28 and *returns to Mar 31* (previously drifted to the 28th forever), yearly Feb-29 entries recover on leap years, and snoozing a daily 8:00 alarm no longer turns it into an 8:10 alarm forever. Ticks persist state *before* delivering (no re-fire storms, no listener-write clobber); fired one-shot history is capped at 200.
- **People ⇄ Time consistency:** deleting/archiving a contact cancels their birthday reminder (previously fired every year forever); editing a birthday reschedules it; the afternoon-of-birthday fallback no longer anchors the yearly grid at an arbitrary minute. The Contacts app now archives (restorable, with an Archived section) instead of hard-deleting on one click; permanent delete requires confirmation.
- **Cardspoke:** inline #tag sync is now two-way (typing no longer accretes partial-prefix tags; a #tag deleted from the body leaves the tag list); added `unlinkCards` and `setCardPriority`; Tasks and Cards route status/priority/unlink/delete through the Core; task/card deletes confirm first.
- **Files:** trash/restore preserves a deliberately excluded file's index exclusion; AI file-access requests refuse trashed files (consistent with `fileMetaForAI`); the Files dashboard tile respects the trash filter; Empty trash confirms.
- **Monitor:** alerts suppressed by cooldown now retry when the cooldown expires instead of being silently consumed (object, event-style, and webpage paths); an auto-disable during cooldown still reaches watch history.
- **Secrets & Dev:** new secrets default to AI access "none" (brokered use is opt-in per item); Dev Core installs are proposal-gated for real (a `dev.install` external executor registered at boot); `canInstall` compares against `codeUpdatedAt` so re-validating unchanged code no longer blocks install; the artifact size cap measures bytes.
- Smaller fixes: assistant preserves user capitalization in created titles; event bus supports multi-segment wildcards; scheduler election verifies its lease write; the auto-indexer runs in one elected tab; removing a source exclusion is audited (scope-widening was silent); clearing resolved proposals records the lost undo snapshots; external effects no longer double-log `ai.executed`; `object.created/deleted` no longer double-emit with two payload shapes; deleting a project scrubs `projectIds`; ids carry a random component (cross-tab collision); corrupt permission-override tiers are ignored instead of crashing; notification eviction protects critical items and snooze emits `notification.snoozed`; search `type: tag:x` no longer swallows the second filter; empty-body context snippets fall back to the title; malformed `replace-range` ops are rejected instead of becoming whole-document replacements; stopwatch and platform-routing keys registered in `StoreKeys`.
- **Registry honesty pass:** all `usedBy`/`owns` claims corrected against the verified import graph (Time, Cardspoke, Editor, Files, Search, People, Monitor, Web, AI, Secrets, Security, Notification, Media, Dev); unconsumed features (saved filters, outline→tasks, durable trigger payload routing) are explicitly marked API-only.
- Docs updated: architecture.md (storage contract, enforcement state, secrets encryption, search-path accuracy), AGENTS.md gotchas, README (export, gate enforcement).

### Not completed
- Per-label capability matching (mapping an individual manifest label to an individual actionType) — enforcement is tier-level by design for now.
- Dead API surface beyond what got wired (saved filters UI, outline→tasks surface, durable-trigger consumers, grant consumption, most Dev Core surfaces) — marked API-only in the registry rather than force-wired.
- Cross-tab last-writer-wins on whole-array stores within the native storage-event window remains an accepted architectural tradeoff (scheduler election covers timer-driven writes; the indexer is now elected too).
- Secrets vault-aware redaction only covers values decrypted in the current tab while unlocked (cross-tab plainCache staleness documented, not fixed).

### Notes
- Validation: `npm run typecheck`, `npm run build`, and Playwright smoke tests against the production preview — boot (no console errors, seeds intact), assistant → propose → Security gate metadata (risk + undo note) → approve → execute → task created with original casing → audit chain in order, and the negative path (emptied write tiers → proposal refused at the gate, audited, nothing created).
- The audit-redaction and notification-redaction registrations live in Secrets Core (`setAuditRedactor`/`setNotificationRedactor`) because direct imports would cycle.

### Handover
- Next agent should start with: `AGENTS.md`, then this entry; the registry's API-only markers are the honest map of what still needs surfaces.
- Open questions: whether per-label capability matching should replace the tier-level gate; whether saved filters and outline→tasks deserve UI or removal; whether durable trigger payload routing gets its first Core consumer.
- Risks or assumptions: recurring Time entries created before this change have no `anchorAt` (they fall back to the current `at`, so drift stops but is not retroactively healed); new secrets defaulting to AI access "none" changes behavior for flows that assumed brokered-by-default.

## 2026-07-04 - Agent: OpenAI Codex (GPT-5)

### Changed
- Set up Spec-Driven Docs governance for Locus OS using the repository-owned `jxburros/Spec-Driven-Docs` skills and templates.
- Added customized `development-docs/coreIdentity.md`, `development-docs/developmentManifesto.md`, `development-docs/architecture.md`, and `development-docs/productRoadmap.md`.
- Added canonical agent instructions in `AGENTS.md`, a Claude overlay in `CLAUDE.md`, and GitHub Copilot instructions in `.github/copilot-instructions.md`.
- Added this changelog as the append-only project memory required by the Spec-Driven Docs workflow.
- Updated `README.md` with a short governance pointer to the new docs.

### Not completed
- Maintainer-only intent remains open for target-user priority, permanent hard constraints around telemetry/cloud providers, current version theme, and next-version sequencing.
- No code behavior was changed.

### Notes
- Evidence came from `README.md`, `package.json`, `Core API Focus List.md`, `Core Improvement Plans.md`, `Core System Analysis (1).md`, `locus-os-app-core-analysis.md`, `Locus_OS_Standard_Apps.md`, and the current `src/` structure.
- Validation run: placeholder/template hygiene scan, `npm.cmd ci`, `npm.cmd run typecheck`, and `npm.cmd run build`.
- `npm.cmd ci` reported 2 dependency advisories, 1 moderate and 1 high; dependency remediation was not part of this documentation setup.
- The generated docs intentionally mark maintainer-confirmation items instead of inventing unsupported policy.

### Handover
- Next agent should start with: `AGENTS.md`, then `development-docs/coreIdentity.md`.
- Open questions: confirm the current version focus, whether no telemetry/no default cloud are permanent constraints, and whether OPFS/file bytes or model runtime comes next after Core stabilization.
- Risks or assumptions: the roadmap treats Core Stabilization as the current focus based on the repo's analysis docs; maintainer should confirm.

## 2026-10-03 - Agent: OpenAI Codex (GPT-6)

### Changed
- Imported this shell and its complete text source, tests, lockfile, specifications, available audits, and skills into `locus-linux/locus/shell/` from `jxburros/locus-os@99de244663f82f1c21d2a40d95bb05c1b4a3b2b8`. Earlier entries above remain historical records of the original repository.
- Local ownership and platform gates now live in `../docs/integration-plan.md`; `../docs/reference-guide.md` maps all fourteen Cores to local implementations and tests. Updated current docs/skills to the actual v0.6.0 storage/byte/model behavior and the enclosing repository's instructions.
- Added parent Make targets and kept package-local skills visible under the kernel ignore policy. Kept the original URL base, npm lockfile and test assertions. Replaced literal NUL characters in the indexer's source with equivalent escapes for text diffs; Core behavior is unchanged.
- Kept the source SVG icon, omitted binary PNGs, removed PNG manifest/precache/touch-icon references, and bumped the service-worker cache version. Old deployment/CI workflows are not installed in this package.

### Not completed
- No boot image, native service/backend, new Core behavior, mobile raster-icon support, or live shell CI. The original repo is unchanged.
- Browser runs intermittently lose appended records across two tabs: latest unmodified full suite is 10 passed / 1 failed (29/30 appends), despite earlier passing repetitions and an 11/11 rerun. Temporary diagnostics found IDs still missing in both tabs after five seconds; they were removed. The original test and runtime remain unchanged; the cause is unresolved and the PR stays draft.

### Notes
- Local `npm ci`, typecheck, all 497 tests in 20 suites, and production build passed via `make -C locus shell-install` / `shell-check` from the Linux root. Typecheck/unit/build also reran after the source escaping.
- Chromium browser validation used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium CI=1 make -C locus shell-e2e`; covers real sandbox/widgets, concurrent tabs, and production offline PWA. The unresolved failure and passing reruns are recorded above; the browser gate is not claimed clean. Existing build/tooling warnings remain.
- No kernel/QEMU or manual visual/device validation was run: this is source/reference consolidation. Import fidelity, local navigation, tracked skills, and generated-output exclusion were checked. See `../CHANGELOG.md` and decision 001 for full evidence, omissions, and provenance.

### Handover
- Next agent should start with: `../../AGENTS.md`, this package's `AGENTS.md`, and `../docs/reference-guide.md`.
- Open questions: image/base/daemon decisions and intermittent concurrent-append behavior.
- Risks or assumptions: browser contracts are local references for future native conformance; passing browser tests does not certify native enforcement or a bootable system.

## 2026-10-03 - Agent: OpenAI Codex (GPT-6) - Dependency CI repair

### Changed
- Raised Vitest to ^4.1.11 and refreshed its lockfile plus vulnerable transitive baseline-browser-mapping, browserslist, nanoid, and undici to patched compatible versions. Kept all production dependency records unchanged; npm deduplicated Vitest onto the existing Vite 6 toolchain.
- Documented the enclosing repository's OSV base/PR comparison gate. Its whole-tree scans and failure-on-new-vulnerability behavior are retained; see `../docs/decisions/002-dependency-scan-pr-baseline.md`.

### Not completed
- No change to the inherited multi-tab browser defect or upstream kernel documentation dependencies.

### Notes
- Locked install, full npm audit (zero vulnerabilities), typecheck, all 497 unit tests, and production build passed. Existing production bundle warnings remain.
- No runtime source, original test assertion, or import-provenance hash was edited for this fix. Dependency scanning is not a shell test gate.

- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium CI=1 npm run test:e2e -- e2e/pwa.spec.ts` passed both production service-worker/offline-launch checks. Full browser suite was not rerun: the known storage defect is unrelated and unchanged.

### Handover
- Next agent should start with: the local package/lockfile and decision 002; preserve the patched dependency graph.
- Open questions: the separately documented multi-tab defect.
- Risks or assumptions: OSV compares introduced findings against the upstream base; existing baseline reports remain visible.
