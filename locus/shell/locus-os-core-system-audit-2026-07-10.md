# Locus OS Core System and Core-by-Core Stability Audit

**Date:** 2026-07-10  
**Repository:** [jxburros/locus-os](https://github.com/jxburros/locus-os)  
**Reviewed commit:** [`50f9c90bf7510fa12f6758e6dca38cadbc1fb179`](https://github.com/jxburros/locus-os/commit/50f9c90bf7510fa12f6758e6dca38cadbc1fb179) (`main`)  
**Scope:** Shared Core System plus all fourteen Cores. Existing apps were inspected only where needed to prove or disprove a Core contract; app UX and app-specific implementation are otherwise out of scope.

## Executive verdict

Locus OS has a strong architecture and a surprisingly substantial Core implementation. The code type-checks, all 357 Core tests pass, the production bundle builds, the system uses one storage facade, the object model is genuinely shared, Files has recoverable trash, Secrets uses real WebCrypto, and Broker re-authorizes proposals at propose/approve/execute.

It is **not yet ready to be treated as a stable platform for new apps**.

The reason is not compilation or basic happy-path behavior. The blockers are contract-level issues at the seams new apps would depend on:

1. Security authorization is fail-open for unknown/mismatched actions and privileged reads.
2. Capability and Trusted Action scope are based on mutable prose instead of stable IDs and enforceable schemas.
3. AI read visibility does not consistently honor source readability, exclusions, or “Hide from AI.”
4. Proposal redaction omits the actual effect payload.
5. Whole-array localStorage persistence is non-transactional across tabs; several background Cores can overwrite current data.
6. Durable Time triggers can be marked complete before their target consumer runs.
7. Indexing can undo trash/exclusion state.
8. Several Core APIs can cross ownership boundaries or hard-delete data they do not own.
9. Async external executors are recorded as executed before their real work finishes.
10. The service worker, CI workflow, dependency baseline, and documentation do not yet provide a dependable release gate.

No P0 issue was found in the current no-model, metadata-only product. There are multiple P1 issues that become critical as soon as real providers, generated apps, file bytes, or more app surfaces are added. The right next phase remains **Core Stabilization**, not app construction.

## Severity rubric

- **P0 — Critical:** immediate catastrophic data loss, secret exposure, or code execution through an ordinary current flow.
- **P1 — Blocker:** must be fixed before Cores are advertised as a stable app/AI foundation.
- **P2 — Major hardening:** important correctness, recovery, privacy, or claim-honesty gap.
- **P3 — Improvement:** maintainability, edge-case, or future-scale concern.

## Validation performed

| Check | Result |
|---|---|
| `npm ci` | Passed; 145 packages installed |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 14 files, 357 tests |
| `npm run build` | Passed; 139 modules; JS 490.12 kB / 150.46 kB gzip |
| Production preview HTTP checks | `/locus-os/`, `sw.js`, and `manifest.webmanifest` returned 200 |
| `npm audit --omit=dev` | 0 production vulnerabilities |
| Full `npm audit` | 1 high and 1 moderate development-tooling vulnerability |
| Git worktree after audit | Clean; no repository source files changed |
| In-app browser smoke | Not completed: the browser test tab could not attach after the supported retry path |

Passing unit tests are valuable evidence, but all tests are Core-local jsdom suites. There are no equivalent integration suites for storage failure, cross-tab concurrency, boot order, Broker plus Core execution, PWA offline launch, or adversarial browser sandbox behavior.

## Readiness matrix

| Layer/Core | Current strengths | Readiness for new apps |
|---|---|---|
| Core System | Clear local-first architecture, shared object/store boundaries, strict TypeScript | **Blocked** — persistence, action policy, event, PWA, and CI seams need stabilization |
| Time | Broad scheduling API and strong date/recurrence coverage | **Blocked** — trigger delivery and scheduler semantics are not durable/exactly-once |
| Cardspoke | Useful knowledge kernel, links, filters, conversions | **Blocked** — cross-Core mutation and multi-hop conversion loss |
| Editor | Structured operations, diff, stale-base check, export | **Blocked** — caller-controlled ownership and incomplete approval preview |
| Files | Honest metadata model, trash/restore, access proposal shape | **Blocked** — trash-tag collision and source-grant enforcement gaps |
| Search/Index | Deterministic grammar/ranking, relationships, redacted snippets | **Blocked** — source readability/exclusions are not a reliable AI boundary |
| People | Solid contact/cadence/birthday mechanics in one tab | **Needs hardening** — AI disclosure, relationships, background cache, birthday reconciliation |
| Monitor | Strong synchronous watch design and Core composition | **Blocked** — stale cache, malformed-watch failure, AI write path, async webpage races |
| Web | Safe opener defaults and honest CORS failure recording | **Blocked for AI/network use** — fetch policy and async outcome handling need redesign |
| AI | Useful route/context scaffolding; local default | **Blocked before a model** — routing and read policy are largely descriptive |
| Secrets | Real AES-GCM/PBKDF2 vault and audited explicit reveal | **Blocked before providers** — broker placeholder, migration/cross-tab/redaction gaps |
| Security | Three-stage Broker gate, risk model, manifest vocabulary | **Blocked** — action semantics and Trusted scopes are not structurally enforced |
| Notification | Quiet hours, mute, grouping, actions, redaction | **Needs hardening** — multi-tab loss and hold/reliability semantics |
| Media | Honest metadata-only projection and real `canPlayType` calls | **Minimal/deferred** — safe for display metadata, not a media-app foundation yet |
| Dev | Good pipeline shape, CSP, opaque iframe, Worker timeout, versioning | **Blocked for generated apps** — sandbox verdict can be forged; no real installed runtime |

---

# 1. Core System audit

## 1.1 Persistence and recovery

### P1 — Storage failure recovery omits the newest in-memory data

When a write fails, `storage.set()` keeps the new value in the private `unpersisted` map. That is a good failure-honesty decision. However, `exportAll()` reads only localStorage and never merges `unpersisted`. The user-facing failure notification explicitly tells the user to export their data, but that export omits the exact unsaved changes they are trying to rescue.

Evidence: [`storage.ts:167-185`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/storage.ts#L167-L185), [`storage.ts:237-255`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/storage.ts#L237-L255), [`main.tsx:55-73`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/main.tsx#L55-L73).

**Fix:** merge recoverable in-memory values into export, label each store `persisted`/`memory-only`, and provide a recovery download directly from the failure notification. Register the failure listener before seeding or Core initialization so boot-time failures are not lost.

### P1 — Valid JSON is trusted as valid application state

`storage.get<T>()` only verifies JSON syntax. Arrays, required fields, enum values, dates, IDs, and schema versions are unchecked. One structurally invalid but parseable stored value can make a Core throw during boot; all Core initialization runs before React mounts and there is no root recovery boundary.

The stored schema version is written once, but there is no migration registry for most Core stores. This is especially risky before new apps begin adding fields and relationships.

**Fix:** add per-store runtime schemas and versioned migrations. On invalid state, preserve the original, recover valid records individually, and boot a safe recovery surface that can export/reset one store without wiping everything.

### P1 — Whole-array localStorage writes are not transactional across tabs

Objects, audit events, proposals, contacts, watches, notifications, secrets, and artifacts all use cached read-modify-write arrays. A storage event refreshes a module cache only if that module has installed a subscriber. Several background consumers run without such a subscriber. Concurrent tabs can therefore execute from stale state and overwrite newer records.

The Broker has the most serious version of this problem: two tabs can approve the same pending proposal and both execute it because status checking and mutation are not atomic.

**Fix:** move record-oriented state to IndexedDB transactions, use monotonic revisions, and serialize security/destructive operations with Web Locks plus fencing tokens. Keep localStorage for small settings only. At minimum, all mutations must re-read inside one shared lock and reject stale revisions.

### P1 — Broker undo can destroy later edits and cannot restore relationships

Update undo snapshots title/body/tags/task even when only one field changed, then restores them without checking whether the user edited the object after execution. Delete undo recreates only the deleted object; `deleteObject()` already removed inbound card links and project memberships, so those relationships are not restored.

Evidence: [`broker.ts:329-359`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/broker.ts#L329-L359), [`broker.ts:422-442`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/broker.ts#L422-L442), [`objects.ts:203-217`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/objects.ts#L203-L217).

**Fix:** snapshot only changed fields plus expected post-state/revision; reject or three-way merge conflicting undo. A delete undo record must include affected inbound edges and project memberships in one transaction.

### P2 — “Append-only audit” is bounded deletion, and multi-tab audit writes can collide

The live audit keeps 500 rows and the archive keeps 2,000; older archive rows are silently dropped. This may be a reasonable storage policy, but it is not append-only. The same cached-array concurrency issue can also lose rows across tabs.

**Fix:** call it a bounded audit history, expose retention/export settings and dropped counts, or move it to append-only IndexedDB records with pruning performed explicitly and audibly.

## 1.2 Security, Broker, permissions, and AI context

### P1 — Action authorization is fail-open and action semantics are unbound

Security skips capability checks when capabilities are missing and for caller-declared `readOnly` external effects. Mapped actions compare mutable display strings; unmapped actions are allowed when the app has any writable label. No rule binds an action to an owner Core/app, effect kind, object type, target type, allowed fields, or executor.

As a result, a permitted `tasks.create` action can carry a document create or an unrelated update. Unknown actions can fall back to a broad tier check. Existing Security tests explicitly encode several of these permissive defaults.

Evidence: [`security.ts:103-205`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/cores/security.ts#L103-L205), [`broker.ts:307-370`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/broker.ts#L307-L370).

**Fix:** create a typed Action Definition registry:

```ts
interface ActionDefinition<Input, Result> {
  id: ActionId;
  ownerCore: CoreId;
  ownerApp: AppId;
  capabilityId: CapabilityId;
  inputSchema: RuntimeSchema<Input>;
  allowedEffect: { kind: EffectKind; objectTypes?: ObjectType[]; fields?: string[] };
  risk: RiskLevel;
  scope: (input: Input, policy: EffectivePolicy) => boolean;
  execute: (input: Input, context: ExecutionContext) => Promise<ActionResult<Result>>;
  undo?: ...;
}
```

Unknown actions, missing owners, schema failures, mismatched effects, and missing capabilities must deny by default. The action definition—not the proposal caller—must determine read/write classification, risk, executor, and undo text.

### P1 — Trusted capability and Trusted Action are disconnected

Moving a capability to Trusted does not itself authorize auto-run. Enabling a separate Trusted Action can auto-run a capability that remains Writable-with-approval. The action's `scope`, `trigger`, and `dataTouched` are prose; only app, action type, and effect kind are checked.

**Fix:** use immutable capability IDs. A Trusted Action must reference one capability ID and a machine-readable selector for permitted target IDs/types, fields, source IDs, origins, and limits. Auto-run only when the effective capability tier is `trusted` and every selector matches.

### P1 — Proposal redaction ignores the effect payload

Broker redacts summary and detail, but persists the original `effect` for both accepted and refused proposals. Secret-like title/body/tag values and external summaries therefore remain in proposal storage and approval diffs and may later be written to objects.

Evidence: [`broker.ts:118-169`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/broker.ts#L118-L169).

**Fix:** runtime-validate and recursively scan action input before persistence. For sensitive material, refuse the proposal or replace the value with a typed `secret://` reference; do not silently redact data that would change execution meaning. Revalidate immediately before execution and test every sink while the vault is locked and unlocked.

### P1 — AI read visibility is not one enforceable policy

Major bypasses include:

- persisted `aiContextScope` can include an app even after its tile is hidden from AI;
- assistant branches read Time, People, Tasks, and Search directly without checking the assembled context or effective readable tiers;
- objects are not filtered by their source's `readable` flag;
- index exclusions are not reliably enforced at query time;
- global recent audit summaries are included without workspace scoping.

Evidence: [`aiContext.ts:48-109`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/aiContext.ts#L48-L109), [`assistant.ts:150-203`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/assistant.ts#L150-L203), [`desktop.ts:977-985`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/src/core/desktop.ts#L977-L985).

**Fix:** introduce one `AuthorizedReadContext` service used by every assistant/model/tool path. It must intersect current AI-visible surfaces, explicit workspace scope, stable readable capability IDs, source readability, current exclusions, trash state, and secret policy. Return AI-safe DTOs, never raw `SystemObject`s. Keep user search and AI retrieval as separate APIs.

### P1 — External executor outcomes are synchronous fiction

Broker executors return `string | void`. Web starts an asynchronous capture and returns immediately; Files and Dev can return a refusal message. Broker still marks the proposal `executed` and emits an execution audit row.

**Fix:** make executors async and return a discriminated result: `succeeded`, `failed`, `cancelled`, or `partial`, with result IDs, audit-safe detail, and optional compensation. Persist `executing` before dispatch, require an idempotency key, and mark completion only after awaited work finishes.

### P1 — Executor registration can be hijacked

`registerExternalExecutor()` silently overwrites the map entry for an action type. Any later module can replace Files, Web, or Dev behavior.

**Fix:** executor ownership belongs in the typed Action Definition registry. Reject duplicate registration and verify owner Core at boot.

## 1.3 Event system and Core registry

### P2 — Events are often emitted twice with incompatible payloads

`audit.record()` emits an `AuditEvent` by default. Many Cores then explicitly emit the same type with a domain object. Subscribers can receive two events for one action with different payload shapes. Files even casts every `file.*` payload to `SystemObject`, including audit and access events.

Examples: Time fire, People create/update/remove, Files lifecycle, Web add/open/capture, Monitor trigger/recover, Notification delivery, Dev validation/run/install, and manifest evaluation.

**Fix:** define an `EventPayloadMap` keyed by event type and publish exactly once. A Core that records and then sends a rich event must use `skipEmit: true`. Audit persistence should subscribe to typed events or receive the same canonical envelope; it should not create a second incompatible event.

### P2 — Registry claims are not executable contracts

`registry.ts` is an excellent inspectable architecture map, but status, events, `usedBy`, and AI path claims are unchecked prose. Several claims are materially ahead of implementation.

**Fix:** add contract tests that verify:

- every Core ID has a module and test suite;
- every declared event is in the typed payload map;
- every action has an Action Definition and stable capability ID;
- every `functional` AI path has a real call site through authorized read/write services;
- every registry boundary has at least one negative test.

## 1.4 PWA, build, CI, and documentation

### P1 — The service worker does not precache the built JS/CSS

The generated production `index.html` references hashed JS and CSS, but neither appears in `APP_SHELL`. They are cached only if requested while the service worker controls a page; on first install the current page is commonly not yet controlled. Offline first launch is therefore not guaranteed.

The audit confirmed both generated assets were absent from the explicit precache list.

**Fix:** inject the build manifest into the service worker or use a small build-time generator so every hashed shell asset is precached and versioned by content hash. Add a browser test: clean profile → first visit/install → close → offline launch.

### P1 — Service-worker activation deletes unrelated origin caches

Activation deletes every Cache Storage entry whose name is not the current Locus cache. On a shared origin such as GitHub Pages, this can remove caches owned by other projects.

Evidence: [`public/sw.js:32-40`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/public/sw.js#L32-L40).

**Fix:** delete only names with a Locus-owned prefix. Also validate `res.ok` and HTML content type before replacing the navigation shell, and keep stale-while-revalidate work alive with `event.waitUntil()`.

### P1 — Core tests do not gate pull requests or deployment

The Pages workflow runs `npm ci` and `npm run build`, but not `npm test`; it triggers on push to `main`, not pull requests. A Core regression can merge and enter deployment before its suite runs anywhere.

Evidence: [`.github/workflows/pages.yml:3-32`](https://github.com/jxburros/locus-os/blob/50f9c90bf7510fa12f6758e6dca38cadbc1fb179/.github/workflows/pages.yml#L3-L32).

**Fix:** add a pull-request validation workflow with `npm ci`, typecheck, all tests, build, and an artifact report. Require it in branch protection; deploy only after the same commit passes. Add browser integration jobs for PWA offline, proposal execution, and Dev sandbox adversarial cases.

### P1 — Development dependencies contain current advisories

The full audit reports a high Vite advisory and a moderate esbuild advisory; production dependencies are clean. Vite 5.4.21 is affected by the Windows `server.fs.deny` bypass. Vite 6.4.3 is the patched bridge that retains Node 18 support; Vite 8 is the current major but requires Node 20.19+ and a coordinated plugin migration. See the [GitHub Vite advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) and [Vite 8 migration guidance](https://vite.dev/guide/migration.html).

**Fix:** at minimum upgrade and verify Vite 6.4.3; preferably align Vite 8, Vitest 4, and `@vitejs/plugin-react` 6 after setting Node 20.19+ as the supported baseline. Re-run all 357 tests and production/PWA smoke.

### P2 — The documented Node baseline is already false

README says Node 18+, but Vitest 4.1.9 requires Node 20+ and jsdom 29.1.1 requires Node 20.19+/22.13+/24+. There is no `engines` field.

**Fix:** set `engines.node` to `>=20.19`, add a version file/toolchain declaration, and update README/AGENTS/CI. Alternatively downgrade test tooling deliberately, but do not advertise an unsupported runtime.

### P2 — Governance documents contradict current code

Examples:

- AGENTS/Copilot/roadmap still contain “no test script” or “no formal runner” statements.
- Roadmap says Broker enforcement and encryption are incomplete, while code partially implements both.
- Architecture first calls enforcement incomplete and later describes it as enforced.
- README says no app starts Trusted, while several manifests contain default Trusted labels.
- Vault manifest still calls values obfuscated/encryption planned, while Secrets uses AES-GCM.
- Settings displays version 0.2.0 while package/README are 0.5.0.

**Fix:** complete one claim-honesty pass after code fixes. Until then, downgrade AI, Secrets, Security, and related registry statuses to `minimal`/`partial` rather than `functional`.

---

# 2. Core-by-Core review

## 2.1 Time Core

**What is strong**

- Persisted alarms, timers, events, reminders, and triggers.
- Local-date helpers and shared 12/24-hour formatting.
- Anchored daily/weekly/monthly/yearly recurrence, snooze, missed catch-up, bounded history.
- One shared scheduler/job registry and Notification/Audit routing.
- Listener isolation and useful `describeUpcoming()` AI view.

**Findings**

- **P1:** Assistant `time.reminder` approval creates a task object, not a `TimeEntry`; nothing is scheduled.
- **P1:** Time persists a due entry as fired before target listeners run. Missing/throwing consumers are swallowed with no retry. Production starts Time's immediate scheduler before People registers its birthday handler, so cold-boot catch-up can lose People-specific work.
- **P1:** Scheduler localStorage failure stops all elected jobs instead of falling back locally; lease acquisition is non-atomic.
- **P2:** A daily time inside a DST spring-forward gap can normalize to a later hour and remain shifted, so the blanket “DST-safe” claim is too strong.
- **P2:** Recurring missed occurrences do not retain a missed outcome.
- **P2:** Stopwatch truth remains app-owned instead of Time-Core-owned.
- **P3:** Duplicate scheduled-job names replace silently; an old disposer can remove the replacement.

**Fix and tests**

Create typed, brokered Time actions; register all consumers/jobs before the scheduler starts; use a persisted dispatch outbox with attempt/ack/retry/dead-letter state; use Web Locks/fencing; persist calendar components and explicit gap/fold policy. Add boot-order, blocked-storage, concurrent-leader, DST gap/fold, recurring-missed, and Broker-to-Time tests.

**Readiness:** blocked until durable dispatch and multi-tab scheduling are fixed.

## 2.2 Cardspoke Core

**What is strong**

- Shared card/task/document CRUD, wiki links, backlinks, related tags, saved filters, typed task queries, outline conversion, and immediate reversible conversions.

**Findings**

- **P1:** `updateCard`, `deleteCard`, and `convertCard` do not verify that the target is a Cardspoke-owned type. A file ID can be hard-deleted or converted, bypassing Files ownership.
- **P1:** Multi-hop conversion overwrites the single `previousShape`; task → card → document → task loses the original task state despite the lossless claim.
- **P2:** Duplicate-title backlink reporting disagrees with deterministic wiki-link resolution.
- **P2:** Editor/Broker body updates use generic `updateObject`, bypassing Cardspoke inline-tag synchronization.
- **P2:** Card/task/document delete has no recovery contract.
- **P3:** Duplicate outline bullets can create duplicates within one conversion call.

**Fix and tests**

Enforce owner/type guards at the Core and object-store boundary; store per-type snapshots or a bounded conversion history; route body edits through type-aware adapters; add generic object trash/recovery. Test every conversion permutation, non-owned IDs, duplicate titles, inline-tag edits through Broker, and deletion recovery.

**Readiness:** blocked by ownership and conversion integrity.

## 2.3 Editor Core

**What is strong**

- Selection/transforms, bounded undo/redo, original-offset operations applied back-to-front, overlap rejection, line diff, export, proposal staleness check.

**Findings**

- **P1:** Unsupported file/project targets fall back to Writer permissions, and callers can override the proposing app. Ownership and policy identity are caller-controlled.
- **P1:** Title changes execute but are absent from the preview; a rename-only proposal can show no line changes.
- **P2:** `updatedAt` milliseconds are used as a version token; same-millisecond writes can evade stale detection.
- **P2:** The structured operation list and base snapshot are discarded; the proposal persists only final fields.
- **P2:** A denied Broker proposal is still logged as `editor.transaction.proposed`.
- **P2:** Current proof UI's custom redo stack can overwrite later typing because ordinary edits are outside the Editor session.

**Fix and tests**

Derive owner app/Core from target type; reject unsupported targets; persist a complete redacted field preview and operation record; add monotonic revisions/content hashes; make editor sessions observe all edits. Test target spoofing, title preview, same-ms conflicts, denial audit, full Broker execution/undo, and redo branch invalidation.

**Readiness:** blocked until policy identity and complete preview are enforced.

## 2.4 Files Core

**What is strong**

- Honest metadata-only model, add/rename/recents, soft trash/restore with pre-trash index state, redacted AI metadata, proposal-shaped one-shot access.

**Findings**

- **P1:** Legacy compatibility treats a normal `trash` tag as lifecycle state. `emptyTrash()` can permanently delete a legitimately tagged file.
- **P1:** Source grants are listed but not enforced by access requests or `fileMetaForAI()`.
- **P2:** File events are duplicated and cast to the wrong payload type.
- **P2:** Access approval does not revalidate file type, trash, or source readability.
- **P2:** Grant consumption selects the first unused grant for a file rather than the exact newly minted grant.
- **P2:** Approval says contents are read and undo says a grant can be revoked, but current behavior releases metadata immediately and has no revoke path.
- **P2:** Permanent empty-trash has no Core-level confirmation token or recovery snapshot.

**Fix and tests**

Run a one-time legacy migration and stop interpreting tags as lifecycle state; centralize source authorization; bind grants to exact ID, proposal, file, purpose, requester, revision, and expiry; make access executor async/typed; require a destructive confirmation token and recovery manifest. Test unreadable/trashed/raced files, exact grant use, event shape, reindex-after-trash, and recovery.

**Readiness:** blocked by a live hard-delete collision and unenforced grants.

## 2.5 Search / Index Core

**What is strong**

- Unified app/object/contact search, surfaced query errors, inclusive local dates, deterministic ranking, trash/index filtering, relationships, redact-before-truncate AI snippets.

**Findings**

- **P1:** `source.readable` does not control Search AI retrieval or AI context object inclusion.
- **P1:** Adding an exclusion only stores a string; it does not immediately remove content from retrieval. The matcher normalizes pattern and candidate inconsistently, so exact paths and `*` can fail.
- **P1:** Full `runIndex()` writes nonmatching objects back to `indexed`, overwriting Files trash or other explicit exclusion state.
- **P2:** AI relationship lookup returns full raw objects without source authorization/redaction.
- **P2:** Source IDs and matching tags can reach labels/UI without the same redaction pass.
- **P3:** Calendar-invalid dates such as `2026-99-99` pass shape validation.
- **P3:** Manual indexing does not emit the declared `index.updated` event; auto reindex does not stamp source last-indexed state.

**Fix and tests**

Use one current policy predicate at query time; model exclusion provenance as independent reasons; implement tested normalized glob matching; split `searchForUser()` from `retrieveForAI()` returning safe DTOs. Add dedicated Sources/Indexing suites covering toggles, glob changes, reindex/trash interaction, relationship authorization, invalid dates, and redaction.

**Readiness:** blocked; this is not yet a trustworthy AI retrieval boundary.

## 2.6 People Core

**What is strong**

- Contact CRUD with archive/restore, sensitive-field audits without values, channel-specific capped interaction history, per-contact cadence, Feb-29 handling, Time-backed birthday reminders, cleanup on archive/delete, and AI view excluding phone/email/social.

**Findings**

- **P1:** Birthday is classified sensitive but month/day is always included in `contactForAI()` despite no readable birthday capability and registry wording that promises identity plus cadence.
- **P1:** Background consumers can use stale contacts indefinitely because cache refresh is tied to UI subscription.
- **P1:** There is no stable person↔object relationship model—only one unchecked `notesCardId`, no task links, reverse lookup, or repair.
- **P2:** Birthday scheduling is limited to a 30-day boot horizon; a long-running PWA can cross into the horizon without scheduling.
- **P2:** Contact rename leaves reminder labels stale; near-midnight fallback can anchor the recurring reminder incorrectly.
- **P2:** Birthday validation accepts normalized invalid dates; cadence/horizon math uses fixed milliseconds instead of shared calendar-day semantics.
- **P2:** “Details after approval” is claimed but no read-grant path exists.

**Fix and tests**

Gate/remove birthday in the default AI view; make cache invalidation unconditional; define indexed person relationship IDs/table; run elected daily birthday reconciliation or schedule every active contact; use strict date validation and Time helpers. Test capability gating, cross-tab updates, horizon rollover, simultaneous boot, rename/reconciliation, invalid dates, and referential integrity.

**Readiness:** contact/cadence CRUD is a good base, but AI and relationship contracts must be completed.

## 2.7 Monitor Core

**What is strong**

- Editable declarative watches, Core-owned domain evaluation, shared scheduler, fingerprints, cooldown/escalation for synchronous watches, event-style file changes, missing-target disable, snooze/pause, bounded history, webpage timeout/in-flight guard, and Notification delivery.

**Findings**

- **P1:** Background evaluation can run on a stale watch cache and later erase another tab's changes.
- **P1:** Raw watch names/messages are stored in Monitor history after only Notification/Audit copies are redacted.
- **P1:** One malformed persisted watch can throw and stop the whole evaluation pass.
- **P1:** Registry tells AI to call direct `createWatch({createdBy:"ai"})`; this writes immediately and bypasses the manifest's approval requirement.
- **P2:** An in-flight webpage result can alert/update after pause, snooze, URL edit, or config change.
- **P2:** Webpage alerts do not persist cooldown state, use escalation, or emit/record recovery.
- **P2:** Webpage URL validation/privacy options are insufficient and should be owned by Web Core.
- **P2:** File-change detection uses millisecond `updatedAt` and can miss same-ms edits.

**Fix and tests**

Use transactional watch records/revisions; redact before history/events; validate each watch and isolate failures; create brokered Monitor actions; add request tokens/revisions and cancel stale fetches; route reachability through a hardened Web adapter. Test all asynchronous user-intent races, malformed records, cross-tab collision, AI refusal, redaction, cooldown/recovery, and same-ms edits.

**Readiness:** synchronous design is promising, but persistence and async/network paths block a stable API.

## 2.8 Web Core

**What is strong**

- Shortcut CRUD/de-duplication, explicit HTTP(S) scheme allowlist, `noopener,noreferrer` opener, proposal-gated page metadata, timeouts, DOM parsing without script execution, redaction/truncation, honest CORS/HTTP failure records, and Monitor delegation for watches.

**Findings**

- **P1:** Page-context fetch accepts URL userinfo, token query strings, private destinations, redirects, and HTTP. It does not set `credentials:"omit"`, no-referrer/no-store, redirect validation, MIME validation, or a response-size cap.
- **P1:** App manifest forbids page-content reads while runtime fetches a full body under a `readOnly` effect that Security does not capability-check.
- **P2:** Captured page context is not included in authorized AI context despite registry claims.
- **P2:** Broker marks the proposal executed before the asynchronous capture completes.
- **P2:** Event payloads are duplicated/incompatible.
- **P2:** Sensitive URL userinfo/query data can enter storage, audit summaries, and structured events.
- **P3:** One hostname-dot rule rejects legitimate localhost/intranet/IPv6 while permitting private IPv4; navigation and AI fetch need distinct policies.

**Fix and tests**

Separate navigation from AI-fetch normalization; reject userinfo; block local/private targets by default; omit credentials/referrer/cache; validate every redirect and MIME; stream to a byte cap; make executor awaited/typed; add a precise stable capability ID. Test redirects, cookies, private network, MIME/size, secret URLs, async outcomes, Security integration, and AI inclusion/exclusion.

**Readiness:** minimal shortcut use is reasonable; privileged web/AI use is blocked.

## 2.9 AI Core

**What is strong**

- Clear intent-to-Core map, proposal wrapper, persisted keyword rules without user regex construction, local default, context scaffolding, Core-shaped summaries, and honest no-model documentation.

**Findings**

- **P1:** `proposeThroughCore(core, ...)` only writes the supplied Core name into an audit sentence; it does not validate routing or persist a verified origin Core.
- **P1:** Editor, Files, and Web proposal paths call Broker directly, so the registry claim that every AI write traverses AI Core is false.
- **P1:** Assistant read branches bypass the context/permission policy.
- **P2:** A cloud rule is displayed/audited as “routed to cloud” while the local deterministic parser actually handles it and no provider exists.
- **P2:** Substring keyword matching can route on accidental partial words; dangerous if later used for cloud dispatch.
- **P2:** Enable/disable/remove routing changes are not audited, and arbitrary model hints are unbounded/unresolved.
- **P2:** Many route-table entries are descriptive future paths rather than executable routes; `functional` overstates enforcement.

**Fix and tests**

Derive Core/action ownership from the Action Definition registry and persist verified `originCore`; use the authorized read service for every branch; distinguish requested, available, and executed route; use explicit match modes; audit all policy changes. Add AI-context, assistant, Broker/AI, provider-unavailable, scope, redaction, route mismatch, and word-boundary integration tests.

**Readiness:** blocked before any real model/provider is connected.

## 2.10 Secrets Core

**What is strong**

- Real WebCrypto PBKDF2/SHA-256 at 600k iterations, random salt, non-extractable AES-GCM key, per-value IV, lock/unlock, wrong-passphrase rejection, idle lock, legacy migration, explicit audited reveal, reference-only AI view, and broad pattern redaction.

**Findings**

- **P1:** “Brokered use” accepts a caller-supplied requester, bypasses Security/Broker, never injects/decrypts a usable value, yet records success and `lastUsedAt`.
- **P1:** Stored non-pattern vault values can only be redacted while the vault is unlocked; locked-vault tests explicitly accept exposure.
- **P1:** Invalid legacy base64 decodes as empty and migration overwrites the original with encryption of an empty value.
- **P1:** Ref slug collisions can rotate a different secret accidentally.
- **P1:** Cross-tab rotation/add/delete does not invalidate plaintext cache; one tab can reveal stale plaintext under updated metadata.
- **P2:** AES-GCM ciphertext is not bound to secret ID/ref with AAD, so valid ciphertext records can be swapped.
- **P2:** Unlock can silently omit corrupted items and still report success.
- **P2:** Deletion is immediate and unrecoverable; no rekey/recovery/minimum-passphrase/background-lock workflow.
- **P2:** Public `listSecrets()` exposes encrypted value internals instead of a metadata DTO.

**Fix and tests**

Make public use create a typed `secrets.use` proposal; only an internal executor receives a short-lived scoped value. Strictly preserve failed migrations, use stable IDs/explicit rotation, bind AAD, decrypt on demand or bind cache to ciphertext revision, report partial unlock, add encrypted trash and rekey/recovery. Test all corruption, collision, cross-tab, swap, locked outbound, Broker, and recovery paths.

**Readiness:** crypto foundation is strong, but provider-facing use is blocked.

## 2.11 Security Core

**What is strong**

- Broker gate at three lifecycle stages, effect shape checks, hard-forbidden namespaces, risk/approval data, basic undo snapshots, canonical manifest vocabulary, dependency/network/secret policy, and extensive unit tests.

**Findings**

- **P1:** `ACTION_LABELS` and fallback policy use mutable English prose and default-permissive behavior.
- **P1:** Missing capabilities and caller-asserted `readOnly` bypass enforcement.
- **P1:** Action type, effect, object, target, fields, owner, and executor are not bound.
- **P1:** Trusted scope is descriptive and disconnected from effective Trusted tier.
- **P1:** External executor registration can be overwritten.
- **P2:** Generic undo/revoke notes are false for current external actions.
- **P2:** Approval data lists field names, not complete target/value/diff impact.
- **P2:** Risk/undo fields from persisted proposals are trusted instead of recomputed.
- **P2:** Manifest events duplicate and structured payloads bypass text redaction.
- **P2:** Manifest permission is validation metadata; no installed runtime currently enforces it.

**Fix and tests**

The typed Action/Capability registry is the central fix. Default-deny unknown/mismatched behavior; use immutable IDs and migration; derive risk/read-only/executor; enforce machine scope; recompute approval facts at decision time. Add adversarial Broker tests for every bypass and tampered persisted proposals.

**Readiness:** the primary blocker for the whole platform.

## 2.12 Notification Core

**What is strong**

- All current senders use `deliver()`, Settings exposes quiet hours/mute, surfaces use snooze-aware counts, critical bypass exists, and title/detail redaction, actions, grouping, history, and scheduled release are implemented.

**Findings**

- **P1:** Concurrent cached-array writes can lose notifications; release-job `touch()` can overwrite a newer inbox.
- **P2:** Time alarms are only `high`, so quiet hours suppress them until the window ends. Priority and breakthrough policy are conflated.
- **P2:** Quiet holds and user snoozes share `snoozedUntil`; changing/disabling quiet hours does not reconcile held items.
- **P2:** The 60-item cap eventually evicts held/unread/critical entries, contradicting the “held, not dropped” promise.
- **P2:** Source and action labels are rendered but not redacted/validated.
- **P2:** Malformed persisted policy can make `deliver()` throw.
- **P3:** Raw `pushNotification()` remains exported, so the “only delivery path” boundary is conventional, not structural; `deliver()` returns no receipt.

**Fix and tests**

Use transactional notification records; separate priority from interruption policy and user snooze from policy hold; reconcile holds on policy changes; separate pending attention from bounded history; normalize policy; make raw storage private; return a delivery receipt. Test concurrency, alarm/quiet integration, policy changes, overflow, malformed state, redaction, persistence failure, and DST windows.

**Readiness:** usable single-tab, but not reliable infrastructure until loss/hold semantics are fixed.

## 2.13 Media Core

**What is strong**

- Metadata projects from Files rather than a second store; trash is excluded; extension can correct stale declared kind; audio/video call real `canPlayType`; permission seam is honest; thumbnails/playback are explicitly deferred until bytes exist.

**Findings**

- **P2:** File extension parsing does not strip query/hash components, so URL-like refs such as `song.mp3?token=...` are misclassified.
- **P2:** Image support is hard-coded as universally renderable for formats such as SVG/AVIF rather than probed; this is less honest than the audio/video path.
- **P2:** The AI-facing metadata functions do not enforce source readability or redact titles; no current model calls them, but registry advertises them as AI contracts.
- **P2:** Future byte-backed detection must not trust extensions over MIME/content; extension precedence is safe only for the current metadata prototype.
- **P3:** `canPlayType` elements are recreated for every item/render; cache per extension/environment.
- **P3:** Permission query has no request/grant/audit API, only state inspection.

**Fix and tests**

Normalize URL/path refs; probe or conservatively report image support; provide separate UI metadata and authorized/redacted AI DTOs; cache format support; defer byte/playback APIs until Files has OPFS/native bytes. Add query/hash, source-readability, title-redaction, image capability, permission-state, and content/MIME tests.

**Readiness:** acceptable as minimal metadata utility; not ready for media applications.

## 2.14 Dev Core

**What is strong**

- Clear artifact/version/provenance model, bounded rollback points, manifest evaluation, secret scan, size policy, inline-script escaping, opaque-origin sandbox iframe, CSP network deny, Worker isolation/timeouts, captured logs, and install gate requiring validation plus a current successful run.

**Findings**

- **P1:** Artifact code shares the Worker global containing `send`; it can call `send("done")` and forge a successful run. The outer harness trusts that result.
- **P1:** `createArtifact()`/`updateArtifactCode()` persist arbitrary draft size before validation. One 64 kB current file plus 25 full versions approaches localStorage limits; larger rejected drafts can fill storage immediately.
- **P1:** No real-browser test proves CSP network denial, script-escape containment, busy-loop termination, or verdict integrity. Existing install “success” test never performs a passing run.
- **P2:** Async artifact work is not actually tested: `new Function()` returns and `done` is sent before asynchronous failures/timers complete.
- **P2:** Sandbox logs are persisted raw; non-pattern sensitive data in code/logs can bypass redaction, especially while the vault is locked.
- **P2:** Removing an artifact hard-deletes it, leaves orphaned run history, and has no recovery contract.
- **P2:** Editing an installed artifact silently drops it to draft without an explicit uninstall event.
- **P2:** Run/validation freshness uses timestamps rather than artifact version/content hash; same-ms and cross-tab state can accept a stale result.
- **P2:** A refused Dev executor result is still recorded by Broker as executed.
- **P2:** Installed means only a status flag; no runtime currently enforces declared permissions or renders the artifact. Registry should remain minimal.

**Fix and tests**

Run untrusted code in a scope that cannot access harness completion primitives; bind run results to artifact version plus cryptographic content hash; limit size before persistence and store deltas/compressed versions in IndexedDB; redact logs; trash artifacts/runs; return typed executor failure. Add adversarial Playwright tests for forged completion, network APIs, nested Workers, `</script>`, infinite loops, async rejection, log caps, stale hashes, and install failure.

**Readiness:** blocked for generated apps/widgets.

---

# 3. Recommended stabilization sequence

## Wave 0 — Correct claims and add release gates

1. Downgrade overstated Core registry statuses/claims.
2. Align README, architecture, roadmap, AGENTS, Copilot, Vault manifest, version display, and Node requirements.
3. Add PR CI: typecheck, all tests, build, dependency audit, and required branch protection.
4. Add integration-test scaffolding for multi-tab, storage failure, Broker execution, and browser/PWA flows.

## Wave 1 — Build the shared enforcement contracts

1. Typed Action Definition registry with stable action/capability IDs and default deny.
2. Machine-readable Trusted Action scope bound to effective Trusted tier.
3. One `AuthorizedReadContext` service and AI-safe DTOs.
4. Async typed executor results with `executing` state, idempotency, and compensation.
5. Typed exactly-once event payload map.

## Wave 2 — Make persistence durable

1. Versioned StorageAdapter and runtime schemas/migrations.
2. IndexedDB transactional records for objects, audit, proposals, contacts, watches, notifications, secrets metadata, and Dev artifacts.
3. Monotonic revisions/content hashes and Web Locks/fencing.
4. Recovery export that includes memory-only writes.
5. Root safe-mode/error boundary and per-store recovery.

## Wave 3 — Fix Core-specific P1 issues

1. Time outbox/ack delivery and scheduler fallback/boot order.
2. Search source authorization, immediate exclusions, and exclusion provenance.
3. Cardspoke ownership guards and multi-shape conversion history.
4. Editor owner derivation and full-field preview.
5. Files trash-tag migration and exact/revalidated grants.
6. People birthday capability/relationship model/reconciliation.
7. Monitor brokered writes, redacted history, malformed-record isolation, async request revisions.
8. Notification transactional delivery and distinct hold/snooze semantics.
9. Secrets real broker path, safe migration/cross-tab cache/AAD/recovery.
10. Web hardened fetch and awaited results.
11. Dev verdict isolation, content hashes, size-before-persist, adversarial browser tests.

## Wave 4 — Prove app readiness

Do not begin general app rewrites until these gates pass:

- Unknown or mismatched actions deny in Broker integration tests.
- Forbidden/readable/trusted overrides survive label changes via stable IDs and migrations.
- “Hide from AI,” source readability, exclusions, trash, and secret policy all affect one model-context snapshot test.
- Two-tab mutation/approval/delivery/scheduler tests show no duplicate effect or lost record.
- Storage-quota recovery export contains the newest in-memory state.
- Time target actions survive missing/throwing consumers and retry exactly as documented.
- Indexing never revives trash or unrelated exclusion reasons.
- Every destructive Core action has confirmation plus recovery/undo semantics.
- External executor success/failure is awaited and reported truthfully.
- Clean first-install offline PWA launch works in a real browser.
- Dev sandbox adversarial tests cannot forge success or access network/storage.
- Typecheck, 357+ tests, integration suites, build, and dependency policy are required PR checks.

# 4. Suggested ownership of the next work

The first implementation PR should not attempt all fourteen Cores. The highest-leverage slice is:

1. stable Action/Capability definitions;
2. authorized AI read policy;
3. typed async executor outcomes;
4. Broker integration/adversarial tests;
5. documentation status corrections.

That slice resolves or makes enforceable the largest number of findings across AI, Security, Secrets, Web, Files, Editor, Time, Monitor, and Dev. The second PR should address transactional persistence, revisions, recovery export, and multi-tab tests. Only then should individual Core P1 fixes land in smaller focused PRs.

## Final assessment

Locus is not a shaky prototype. Its Core selection, boundaries, local-first philosophy, and composition model are good. The existing implementation contains many mechanisms worth keeping. The current risk is that several inspectable policy claims are stronger than the enforcement behind them, while localStorage whole-array persistence cannot provide the concurrency and recovery guarantees a platform needs.

Stabilize the shared contracts first. Once action definitions, read policy, persistence, events, and release gates are trustworthy, the fourteen Cores can become a genuinely strong base for rewritten apps.
