# Locus OS — Core System Status Report

**Date:** 2026-07-11
**Author:** Claude Code (Claude)
**Branch:** `claude/core-system-audit-report-924z51`
**Baseline audit:** `locus-os-core-system-audit-2026-07-10.md`
**Scope:** Shared Core System plus all fourteen Cores, after a stabilization
pass that resolved the baseline audit's findings and a follow-up independent
review.

---

## 1. Executive summary

The Core System is materially more trustworthy than at the baseline audit. The
seams new apps would depend on — action authorization, AI read visibility,
proposal redaction, external-effect honesty, file trash, index exclusions,
persistence recovery, and the release gate — have moved from *described* to
*enforced* or *honestly bounded*.

What changed at the level that matters:

- **Security is fail-closed.** A write or external effect from an app with no
  capability manifest is denied by default; read-only external effects are
  capability-checked; a Trusted Action auto-runs only while its capability
  actually sits in the Trusted tier.
- **The Broker tells the truth.** It redacts the effect *payload* (not just
  summary/detail), records the *real* outcome of external effects
  asynchronously (`executing` → `executed`/`failed`), rejects executor
  hijacking, and re-reads before approve/execute.
- **AI read visibility is one boundary again.** The assembled context packet
  honors "Hide from AI", source readability, index exclusions, and trash; the
  birthday no longer leaks into the People AI view.
- **The dangerous data-loss collisions are closed.** A plain `trash` tag can no
  longer be mistaken for a soft-deleted file; a full index pass no longer
  revives trashed or explicitly-excluded content; multi-hop object conversion
  is lossless.
- **There is a real release gate.** A PR CI workflow runs typecheck + the full
  test suite + build + a production-dependency audit; the Pages deploy is gated
  on the same checks; the dev-dependency advisory is cleared (Vite 6.4.x).

What did **not** change, and is called out honestly below, is the deep
architecture the baseline audit reserved for later waves: IndexedDB
transactional persistence, a typed Action Definition registry, Secrets AAD, a
real installed Dev runtime, and real-browser adversarial tests. Those remain
the gating items before the platform is "stable for new apps." The right next
phase is still **Core Stabilization**, now with a smaller, sharper remainder.

### Validation performed (this pass)

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed: 16 files, **373** tests (was 357) |
| `npm run build` | Passed; production bundle emitted |
| `npm audit --omit=dev` | **0** production vulnerabilities |
| Full `npm audit` | 0 (Vite/esbuild advisory cleared by the 6.4.x upgrade) |
| Multi-tab / service-worker / real-browser | **Not verifiable in jsdom** — unchanged limitation, called out per item |

New suites added: `src/core/broker.test.ts` (the Broker had none) and
`src/core/cores/registry.test.ts` (structural contract). Existing suites for
security, cardspoke, files, people, web, and dev were extended.

---

## 2. Core System — what was resolved

### 2.1 Persistence and recovery

- **Storage-failure export now includes the newest data.** `storage.exportAll()`
  overlays the in-memory `unpersisted` map and reports `memoryOnlyKeys`, so the
  recovery download the failure notification tells the user to take actually
  contains the unsaved changes. (`storage.ts`)
- **Valid JSON is no longer blindly trusted as valid state.** `storage.get<T>()`
  accepts an optional runtime `validate` guard; a value that parses but does not
  match the expected shape is preserved under the backup key and replaced by the
  fallback, so one malformed record can't throw a Core at boot. (`storage.ts`)
- **Cross-tab consistency for failed writes.** A successful write in another tab
  clears this tab's stale `unpersisted` value. (`storage.ts`)
- **Boot-time failures reach the user.** The storage-failure listener is
  registered before any seeding/Core init. (`main.tsx`)
- **Multi-tab whole-array writes** are mitigated (not eliminated) by
  re-read-before-write in the security-critical paths (Broker approve/execute,
  Monitor evaluator, Notification mutators) and warm module caches for
  background consumers (People, Monitor, Time). Full transactional durability
  (IndexedDB + Web Locks + revisions) remains a Wave-2 item.
- **Audit honesty.** The "append-only" claim is downgraded to "bounded local
  retention" with the drop policy stated. (`audit.ts`)

### 2.2 Security, Broker, permissions, AI context

- **Fail-closed authorization.** `authorizeProposal` denies a write or external
  effect from an app without a capability manifest, and now capability-checks
  read-only external effects via governing labels. (`security.ts`)
- **Trusted tier ↔ Trusted Action reconciled.** `trustedTierPermits` requires the
  capability to sit in the Trusted tier before a Trusted Action auto-runs.
  (`security.ts`, `broker.ts`)
- **Proposal redaction covers the effect payload.** `redactEffect` redacts
  `payload.title/body/tags` and `externalSummary` before persistence, on both
  accepted and refused proposals. (`broker.ts`)
- **External executor outcomes are truthful.** Executors return a typed
  `ExecutorOutcome` (or a Promise of one); a proposal is marked `executing` on
  dispatch and settles `executed`/`failed` on the real result. (`broker.ts`,
  and the Files/Web/Dev/Time executors)
- **Executor registration is once-only.** A second registration for an action
  type is ignored, so a later module can't hijack Files/Web/Dev behavior.
  (`broker.ts`)
- **AI read policy is enforced at assembly.** The context packet excludes
  AI-hidden tiles even against a stale persisted scope, filters objects by
  index-exclusion/source-readability/trash, and scopes recent activity.
  (`aiContext.ts`) AI Core verifies routing and persists a verified `originCore`.
  (`ai.ts`)

Known remaining gap: the rule-based assistant's *direct* read branches
(`describeUpcoming`, `dueFollowUps`, `objectsOfType`) still query Cores without
re-checking the scoped-app set; the assembled context packet the same assistant
exposes does enforce it. Tracked below.

### 2.3 Event system and registry

- Cores that emit a rich typed payload now pass `skipEmit: true` to their
  `record()` call, so an event fires once with one shape instead of twice with
  incompatible shapes (Files, People, Monitor, Web, Dev). (Note: the only live
  bus subscriber was Files' own unused `onFileEvent`, so this was a latent
  correctness fix.)
- `registry.test.ts` asserts the structural contract: 14 unique Core ids
  covering the `CoreId` union, each with a module and co-located test suite, a
  valid status, at least one namespaced event, and AI routes that target real
  Cores.

### 2.4 PWA, build, CI, dependencies, documentation

- **Service worker.** Activation deletes only Locus-prefixed caches (never
  another project's on a shared origin); the navigation-shell cache write is
  guarded on `res.ok`/type and kept alive with `waitUntil`; the precache claim
  is corrected (hashed bundles are runtime-cached on first online load).
- **CI gate.** New `.github/workflows/ci.yml` runs typecheck + test + build +
  production audit on PRs and pushes; the Pages deploy job runs typecheck + test
  before build.
- **Dependencies.** Vite 6.4.x clears the dev-server advisory (0 prod vulns);
  `engines.node >= 20.19` added and documented.
- **Documentation honesty.** Version display (0.2.0 → 0.5.0), Node baseline, the
  "no test script" statements, the "no app starts in Trusted" claim, and the
  enforcement/encryption status in `architecture.md` / `productRoadmap.md` were
  corrected to match the code.

---

## 3. Core-by-core status

Legend: **Improved** (a blocking finding was resolved or meaningfully
mitigated) · **Partial** (mitigated; deeper work remains) · **Deferred**
(acknowledged, not addressed this pass).

| Core | This pass | Residual (next) |
|---|---|---|
| **Time** | Improved — assistant reminders materialize a real `TimeEntry` via a brokered executor; alarms are `critical` (break through quiet hours); scheduler inits last so cold-boot consumers are registered; duplicate-job guard | Durable dispatch outbox/ack, DST gap/fold policy, missed-recurrence outcome |
| **Cardspoke** | Improved — ownership guards on update/delete/convert; lossless multi-hop conversion history | Generic object trash/recovery, backlink/wiki-link symmetry |
| **Editor** | Improved — owner derived from target type (no caller spoof), unsupported targets rejected, title change in preview, no denied-log | Monotonic version token/content hash instead of `updatedAt` ms |
| **Files** | Improved — trash is `deletedAt`-only with a legacy migration; source-grant enforcement; exact grant consume + revoke; typed re-validating executor | Byte-runtime grant consumption; destructive confirmation token |
| **Search/Index** | Improved — live exclusions at query time, normalized glob, `runIndex` preserves trash/exclusions, source-readable AI gate, real-date validation | Exclusion provenance; a separate `retrieveForAI` DTO path; relationship redaction |
| **People** | Improved — birthday withheld from AI view; unconditional cache invalidation; birthday range validation | Stable person↔object relationship model; birthday reconciliation beyond boot horizon |
| **Monitor** | Improved — malformed-watch isolation, redacted history, fresh re-read + warm cache, AI direct-write refused, credential-free reachability fetch | Brokered AI createWatch proposal path; webpage cooldown/escalation state |
| **Web** | Improved — strict AI-fetch normalizer (SSRF/credential guard), hardened fetch, awaited typed executor | Reconcile the manifest's "read page contents" label with the metadata capture; captured context into AI context |
| **AI** | Improved — verified routing + persisted `originCore`; routing changes audited | Route every AI write through AI Core (Editor/Files/Web still call Broker directly); word-boundary keyword matching |
| **Secrets** | Improved — safe legacy migration (no data destruction); cross-tab stale-reveal guard | AAD binding to secret id; recoverable delete; a real brokered-use value path |
| **Security** | Improved — fail-closed; trusted-tier gate; read-only external checked | The typed Action Definition registry (the central remaining item) |
| **Notification** | Improved — re-read-before-write, malformed-policy coercion, label redaction, alarm interruption | Distinct hold-vs-snooze fields; pending-vs-history split |
| **Media** | Improved — query/hash-safe extension, honest SVG/AVIF, redacted+source-gated AI metadata, cached probe | Byte-backed detection (MIME over extension) when bytes exist |
| **Dev** | Improved — size-before-persist, content-hash run/validation freshness, typed refused-install outcome | Sandbox forged-completion isolation; real-browser adversarial tests; installed runtime |

---

## 4. Remaining stabilization sequence

The baseline audit's wave structure still holds; this pass completed most of
Wave 0 and a large slice of Waves 1 and 3. The sharpened remainder:

**Wave 1 (shared contracts) — highest leverage, still open**
1. A typed **Action Definition registry** binding each action id to an owner
   Core/app, effect kind, object/target types, allowed fields, executor, risk,
   and undo — so authorization stops matching mutable capability *labels* and
   unknown/mismatched actions deny structurally. This is the single change that
   most improves Security, AI, Web, Files, Editor, Dev at once.
2. Route Editor/Files/Web AI-write paths through AI Core so "every AI write
   traverses AI Core" becomes true.

**Wave 2 (durable persistence)**
1. IndexedDB transactional records for objects, audit, proposals, contacts,
   watches, notifications, secrets metadata, and Dev artifacts.
2. Monotonic revisions / content hashes and Web Locks + fencing for
   security/destructive operations (the re-read-before-write mitigations here
   are a floor, not the guarantee).
3. A root safe-mode/error boundary and per-store recovery surface.

**Wave 3 (remaining Core P1/P2)**
- Time durable dispatch outbox/ack; Secrets AAD + recoverable delete; Dev
  sandbox verdict isolation + Playwright adversarial suite; Web manifest/label
  reconciliation; People relationship model.

**Wave 4 (prove app readiness)** — the gates in the baseline audit §3 Wave 4
remain the acceptance criteria; several now pass in unit tests (unknown/mismatched
actions deny; hide-from-AI/exclusions/trash affect the context packet; multi-hop
conversion is lossless; recovery export contains memory-only state), but the
multi-tab, offline-PWA, and Dev-sandbox gates need real-browser integration
tests that jsdom cannot provide.

---

## 5. Honest limitations of this pass

- **jsdom cannot exercise** multi-tab storage races, service-worker offline
  launch, or the Dev sandbox iframe/Worker. Those fixes are argued from code and
  covered by unit tests where possible, but not end-to-end verified.
- The persistence fixes are **mitigations on a localStorage whole-array model**,
  not the transactional guarantee a platform ultimately needs.
- Security enforcement is **fail-closed but label-matched**, not yet bound to a
  structural action contract.
- A handful of **scaffolded, no-provider paths** (Secrets brokered-use, AI cloud
  routing) were left honest-but-inert rather than reworked, since no runtime
  consumes them; they are noted in the per-Core residuals.

The foundation the baseline audit praised is intact and now enforces more of
what it claims. Once the Action Definition registry and transactional
persistence land, the fourteen Cores are a genuinely strong base for rewritten
apps.
