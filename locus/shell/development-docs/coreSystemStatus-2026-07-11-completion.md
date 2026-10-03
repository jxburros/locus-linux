# Locus OS — Core System Completion Report

**Date:** 2026-07-11
**Author:** Claude Code (Claude)
**Branch:** `claude/core-system-completion-5fcrpw`
**Supersedes status:** `coreSystemStatus-2026-07-11.md`
**Scope:** The deferred stabilization work that report reserved for "later
waves" — the Action Definition registry, durable persistence, the remaining
per-Core P1/P2 items, and the real-browser acceptance gates.

---

## 1. Executive summary

Every item the prior status report left **Deferred** or called out as a
residual is now done. The Core System no longer has an open stabilization
backlog: the shared contracts are structural, persistence recovers itself,
each of the fourteen Cores closed its remaining P1/P2, and the three gaps
jsdom could never cover — the Dev sandbox, multi-tab races, and offline PWA
launch — are covered by a real-browser Playwright suite that runs in CI.

What changed at the level that matters:

- **Authorization is a structural contract, not label prose.** A typed
  Action Definition registry binds every actionType to an owner Core,
  permitted apps, effect kind, object/target types, a payload-field allowlist,
  an executor owner, and risk/undo. Unknown actions, a spoofed proposing app,
  a mismatched effect, a wrong object type, a stray field, or a caller-asserted
  `readOnly` that disagrees with the definition all deny by default.
- **Every AI write traverses AI Core.** Editor, Files, Web, Monitor, and
  Secrets requests route through `proposeThroughCore`, which stamps the
  verified origin Core from the registry. The claim is now true, not aspirational.
- **Persistence recovers itself.** A write-behind IndexedDB durable mirror
  with monotonic revisions restores anything localStorage loses; the Broker
  lifecycle and other security-critical mutations run through a cross-tab lock;
  a root Safe-mode surface replaces the blank-page failure mode.
- **The per-Core residuals are closed.** Time dispatch outbox; Cardspoke
  recoverable trash; Editor version tokens; Files grant mint-vs-consume split;
  Search exclusion provenance + AI DTO path; People relationship model +
  horizon reconciliation; Monitor brokered watches + async state machine; Web
  captured context into the packet; Secrets AAD + recoverable delete + real
  brokered use; Notification hold/snooze split; Media byte detection; Dev
  sandbox verdict integrity.
- **The acceptance gates pass in a real browser.** Forged-completion,
  network-deny, and busy-loop sandbox cases; two-tab no-duplicate/no-lost
  execution; clean-profile offline PWA launch — all green in Chromium, in CI.

### Validation performed (this pass)

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed: 17 files, **427** tests (was 375) |
| `npm run build` | Passed; production bundle emitted; SW precache manifest injected |
| `npm audit --omit=dev` | **0** production vulnerabilities |
| `npm run test:e2e` | Passed: **9** Playwright tests in real Chromium |

New suites: `src/core/storage.test.ts` (durable mirror, locked updates, stable
references) and `e2e/{sandbox,multitab,pwa}.spec.ts`. Existing Core suites were
extended for every Wave-3 change.

---

## 2. Wave-by-wave: what was resolved

### Wave 1 — shared enforcement contracts

- **Action Definition registry** (`src/core/actionRegistry.ts`). Ten action
  definitions cover every real proposal call site. `authorizeProposal`
  (`security.ts`) enforces them structurally and fail-closed; `registerExternalExecutor`
  (`broker.ts`) refuses an executor for an action whose definition declares none.
- **AI-write routing.** `proposeEditTransaction`, `requestFileAccess`,
  `requestPageContext`, `requestWatchCreation`, and `requestSecretUse` all go
  through `proposeThroughCore`, which derives the verified `originCore` from the
  registry. The rule-based assistant re-checks the context packet's scoped-app
  set before answering Time/People/Tasks reads. Routing keywords match at word
  boundaries.

### Wave 2 — durable persistence

- **IndexedDB durable mirror** (`storage.ts`): every write mirrored write-behind
  with a monotonic per-key revision; `hydrateDurable()` at boot restores keys
  localStorage lost or failed to persist, before seeding. A user reset clears
  the mirror too.
- **Transactional, cross-tab-locked updates**: `storage.update()` (Web Locks +
  in-tab queue fallback). The Broker lifecycle is rebuilt on it — async, and
  two tabs cannot double-execute one proposal or lose a record.
- **Stable references**: `storage.get()` returns one reference per key even for
  absent/invalid keys, so `useSyncExternalStore` snapshots never churn.
- **Root Safe mode** (`SafeMode.tsx`): a boot failure or render crash shows an
  export / per-store reset / retry surface instead of a blank page.

### Wave 3 — per-Core P1/P2

| Core | Closed this pass |
|---|---|
| **Time** | Durable dispatch outbox (ack/retry/dead-letter); explicit DST gap/fold policy; recurring `lastMissedAt` |
| **Cardspoke** | Recoverable object trash + token-gated purge; backlink reporting agrees with wiki-link resolution |
| **Editor** | Monotonic `rev` version token — same-millisecond edits are caught |
| **Files** | Grant mint (approval) vs consume (`openFileWithGrant`, re-validating) split; token-gated `emptyTrash` |
| **Search/Index** | Exclusion provenance (user/source-pattern/trash); `retrieveForAI`/`relationshipsForAI` redacted DTO path distinct from user search |
| **People** | Typed person↔object relationship table (kinds, reverse lookup, repair); daily birthday reconciliation past the boot horizon |
| **Monitor** | Brokered `monitor.createWatch`; async webpage cooldown/escalation/recovery state machine; stale in-flight results dropped |
| **Web** | Manifest "capture page metadata" label reconciled with behavior; readable captures feed the AI context packet |
| **Secrets** | AES-GCM AAD-bound to the secret id; recoverable delete (encrypted vault trash + token purge); real `secrets.use` broker path to a registered consumer; partial-unlock reporting |
| **Notification** | Policy hold (`heldUntil`) vs user snooze (`snoozedUntil`); pending-vs-history eviction (read history only) |
| **Media** | Byte-backed magic-number detection seam (content beats extension when bytes exist) |
| **Dev** | Sandbox verdict integrity: private completion channel + per-run nonce; async rejections fail the run |

### Wave 4 — prove app readiness

- **Playwright real-browser suite** (`e2e/`): Dev sandbox adversarial cases
  (forged completion, network deny, busy loop, async rejection), multi-tab
  proposal race + concurrent-append durability, and offline-PWA first-launch.
- **Offline-capable first launch**: a Vite plugin injects the built hashed
  JS/CSS list into `sw.js`, so `install` precaches the full shell; cache
  matching uses `ignoreVary`/`ignoreSearch`. No "one online load first" caveat.
- **CI**: the PR workflow and the Pages deploy both run the Playwright suite in
  addition to typecheck + unit + build + production audit.

---

## 3. Core-by-core status

All fourteen Cores are **Stabilized** for the current (no-model, metadata-only)
product: their audited P1/P2 items are resolved, and their registry claims are
either enforced or accurately downgraded. The forward work below is **new
capability**, not stabilization debt.

| Core | Forward (next-version capability, not a stabilization gap) |
|---|---|
| Time | Calendar views; interval recurrence; availability/routines |
| Cardspoke | Decks/boards; card history; templates |
| Editor | Comments/suggestions; canvas editors |
| Files | **Real bytes (OPFS / File System Access)** — the metadata→bytes step |
| Search | Semantic search; temporal NL search |
| People | Plant-Pal; mail/calendar integration |
| Monitor | Page content-change watches (needs an engine); device health |
| Web | Embedded engine strategy; real PWA install |
| AI | **A real local/cloud model runtime** behind the enforced proposal seam |
| Secrets | Passkeys; scoped env injection into Dev runs; off-device broker |
| Security | OS-level sandboxing; install-safety scans |
| Notification | Richer action vocabulary; OS-level push |
| Media | Real playback service; byte-backed detection consumers |
| Dev | **Installed widget runtime**; typecheck/lint/test runners |

---

## 4. Honest limitations of this pass

- **The durable mirror is a recovery/quota layer**, not per-object-type
  transactional records. It restores lost keys and captures quota-failed
  writes with monotonic revisions, and `storage.update()` provides cross-tab
  serialization — but the full IndexedDB record model (the M1 migration) is
  still ahead. This is next-version scope, not a stabilization gap.
- **No model runtime, no file bytes, no installed widget runtime.** These were
  always next-version by design; the point of this pass was to make the seams
  they will plug into structurally enforced and honest, which they now are.
- **The scaffolded no-provider paths are honest-but-inert.** `secrets.use`
  fails cleanly when no consumer runtime is registered; AI cloud routing is a
  displayed preference with no dispatch. Both are labeled as such.
- **The Playwright suite pins the local provisioned Chromium** and uses a
  managed browser on CI; the SW precache injection assumes the Vite emitted
  asset naming. Both are noted for anyone changing the build tooling.

With the shared contracts structural, persistence self-recovering, every Core's
residual closed, and the real-browser gates green in CI, the Core System has no
remaining deferred stabilization work. The fourteen Cores are a genuinely
trustworthy base for the next-version capability work (bytes, model runtime,
installed widgets) rather than a foundation still being shored up.
