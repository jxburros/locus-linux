# Locus Linux Changelog

Append-only log of meaningful Locus-layer work in this repository. Never delete, reorder, or rewrite prior entries. Heading format: `## YYYY-MM-DD - Agent: <Tool Name> (<Model Name>)` (or the maintainer's name for human work).

## 2026-07-10 - Agent: Claude Code (Claude)

### Changed
- Established repository governance while the tree is still a pristine upstream mirror (Linux v7.2-rc2, zero divergence): root `AGENTS.md` (hard constraints, instruction hierarchy, validation expectations) and `CLAUDE.md` overlay.
- Created the `locus/` layer: `locus/README.md` (purpose, layout, policy), `locus/docs/readiness-plan.md` (phases R0–R5 mapped to the cross-repo M-gates, upstream sync policy, open decisions), and this changelog.
- Added skills: `locus/skills/locus-kernel-fork-hygiene` (pristine-tree rules, branch/sync model, decision-record requirement for any kernel patch) and `locus/skills/locus-image-boot` (kiosk boot chain, config-fragment rules, image pipeline and CI conventions).
- Declared policy: wrapper first, fork only on demonstrated need; all Locus content additive under `locus/` + root agent docs; merge-based sync from stable/LTS tags.
- The canonical cross-repo integration plan was added to the sibling repo as `locus-os/development-docs/linuxIntegrationPlan.md` (same branch, same session).

### Not completed
- R1–R5 are plans, not work: no LTS base pinned, no config fragments, no image pipeline, no CI, no `locus-cored`. Blocking maintainer decisions are listed in the readiness plan.

### Notes
- Validation: documentation-only change; no build run (nothing here can affect a build). Verified before writing that the tree contained zero Locus-specific content and that `master` matched `origin/master`.

### Handover
- Next agent should start with: `AGENTS.md`, then `locus/docs/readiness-plan.md`; the next concrete work (R1 base pin) is blocked on the maintainer's LTS decision.
- Open questions: LTS base version; image builder; `locus-cored` placement; reference hardware; naming of the bootable form.
- Risks or assumptions: the tree currently tracks mainline v7.2-rc2 — do not build product work on it before the R1 pin.

## 2026-10-03 - Agent: OpenAI Codex (GPT-6)

### Changed
- Made Linux development/reference self-contained: imported 191 tracked text files from `jxburros/locus-os` commit `99de244663f82f1c21d2a40d95bb05c1b4a3b2b8` into `locus/shell/`, including the full shell, fourteen Core implementations, shared types, tests, lockfile, design/identity/architecture/roadmap, available audits, historical changelog, and contributor skills.
- Recorded source hashes and omissions in `locus/docs/shell-import.json`; adopted decision 001 for local ownership. No submodule, sibling checkout, or remote bundle is required.
- Added the local canonical integration plan and reference guide; reconciled obsolete metadata-only Files, missing IndexedDB, inert model-runtime, and test-coverage claims. Updated root/shell instructions, image skill, and readiness plan to local authorities and image inputs.
- Added `locus/Makefile` shell install/dev/check/build/preview/e2e commands. Preserved the URL base and lockfile. Kept only the source SVG icon, removed missing PNG precache/manifest/touch-icon references, and bumped the worker cache name to honor the no-binary rule.
- Escaped two literal NUL characters in the imported indexer's glob matcher as equivalent `\u0000` source text for Git reviewability. All other `src/` and e2e test content matches the source commit. Unignored shell-local contributor guidance without modifying upstream ignore rules.

### Not completed
- No kernel/base/config, bootable image, QEMU validation, native daemon, IPC, hosted inference, or automatic shell CI was added. The reference-ownership work does not complete R1–R5 or M2–M6.
- Browser validation exposes an inherited intermittent multi-tab append-loss defect: full runs can finish 10/11 with 29 rather than 30 records. Five repetitions of both multi-tab tests and one full rerun passed, but the later full run failed again. Temporary diagnostics observed missing IDs in BOTH tabs even after five seconds of read-only polling, so this is not merely an immediate final-read timing assertion. The cause remains unresolved; diagnostic edits were removed and original tests retained. The consolidation PR stays draft; no runtime storage fix or weakened assertion was introduced.
- Raster-only mobile home-screen icon support is not claimed. The former source repo is unchanged; this is a local ownership/import change, not a paired release or deletion.

### Notes
- Consulted identity, manifesto, architecture, roadmap, integration plan, repo instructions and task-matched hygiene/image/translation/portability/validation skills; used local storage/Core and PWA release guidance during validation review.
- Ran `make -C locus shell-install` from this repository: locked install succeeded without a sibling dependency.
- Ran `make -C locus shell-check`, including after the text escaping: typecheck passed, 20 unit suites / 497 tests passed, and production build passed. Existing Vite/plugin deprecation and bundle-size/dynamic-import warnings remain.
- Ran `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium CI=1 make -C locus shell-e2e`: Chromium exercises widgets, sandbox adversarial cases, multi-tab persistence, service worker control, and offline launch. Latest unmodified-suite result: 10 passed, 1 failed (concurrent appends). Passing reruns do not establish a clean browser gate. No hardware/kiosk/manual layout validation is claimed.
- Verified local navigation links, import/source fidelity, all 191 imported paths tracked, no binary/generated artifacts or symlinks staged, and no changes outside `locus/` plus root agent docs. Imported historical Markdown hard-break whitespace and one existing TS trailing space are preserved; new non-imported files pass `git diff --check`.
- Kernel builds were intentionally skipped because no kernel or image inputs changed.

### Handover
- Next agent should start with: `locus/README.md`, `locus/docs/reference-guide.md`, and `locus/docs/integration-plan.md`; all necessary specifications/contracts are local.
- Open questions: existing LTS/builder/daemon/hardware decisions; root workflow placement exception for future shell CI; inherited intermittent multi-tab append loss (blocking a clean browser gate).
- Risks or assumptions: the imported browser baseline is a reference implementation, not proof of native or image readiness. Future shell changes belong here; original hashes are provenance, not an automatic synchronization rule.

## 2026-10-03 - Agent: OpenAI Codex (GPT-6) - Dependency CI repair

### Changed
- Diagnosed PR #2's failing check from GitHub run 37154654681: OSV reported introduced npm development-dependency vulnerabilities and pre-existing upstream Sphinx/Python findings. This was the dependency job, not the separately documented browser test failure.
- Updated Vitest/mocker to 4.1.11 and the affected compatible transitive packages: baseline-browser-mapping 2.11.27, browserslist 4.29.3, nanoid 3.3.19, and undici 7.30.0. Regenerated the lockfile with npm; resolution also deduplicated Vitest onto the existing Vite 6 installation. Production dependency records are unchanged.
- Switched the existing OSV workflow to its official PR comparison workflow at the same v2.3.8 release, keeping full-tree scans, failing on newly introduced vulnerabilities, and publishing both baseline/proposed reports. Added decision 002 and the narrow existing-workflow layout exception. No upstream requirements, ignored vulnerabilities, or severity thresholds were changed.
- Updated README and architecture guidance for dependency validation.

### Not completed
- Existing upstream dependency findings remain in the baseline reports; green PR scanning does not certify a vulnerability-free upstream tree.
- The separately documented intermittent multi-tab storage issue is unchanged. No kernel/image/native work was undertaken.

### Notes
- `npm ci` and full `npm audit` passed (zero vulnerabilities, development dependencies included).
- `make -C locus shell-check` passed: typecheck, 20 suites / 497 unit tests, and production build. Production Vite chunk-size/dynamic-import warnings remain.
- Parsed the workflow YAML and inspected the official reusable workflow's base/head scanning, reporting, and failure semantics. GitHub's check on the pushed commit is the authoritative OSV validation.
- Original import hashes remain provenance; later dependency maintenance intentionally changes the local lockfile. No kernel build was required.

- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium CI=1 npm run test:e2e -- e2e/pwa.spec.ts` passed both production service-worker/offline-launch checks. Full browser suite was not rerun: the known storage defect is unrelated and unchanged.

### Handover
- Next agent should start with: decision 002 and PR #2's dependency check; use full npm audit for subsequent shell dependency updates.
- Open questions: the existing multi-tab storage defect and image/native phase decisions.
- Risks or assumptions: PR gating detects newly introduced findings; pre-existing upstream findings require upstream maintenance separately.

## 2026-10-03 - Agent: OpenAI Codex (GPT-6) - Bound dependency scan checkout cost

### Changed
- Replaced the official PR reusable workflow's full-history checkout after hosted run 37155373101 remained in checkout for over six minutes. Use the same pinned official OSV scanner/reporter actions with exact base/merge SHA shallow checkouts into the same source path.
- Preserve complete-tree comparison, failure-on-new-findings, the existing check name, and SARIF upload. Store and upload both complete reports outside the checkout; cancel obsolete runs for the same PR. Updated decision 002 to the final implementation.

### Not completed
- Existing upstream baseline findings and the independent multi-tab defect remain unchanged.

### Notes
- Workflow-only refinement after successful dependency audit, 497 unit tests, build, and offline PWA checks; no shell source/package changes since those checks. Parsed the YAML and verified refs, report paths, pinned actions, and reporter failure arguments. Hosted CI verifies the resulting job.

### Handover
- Next agent should start with: decision 002 and the latest PR dependency check/report artifacts.
- Open questions: the existing browser storage defect.
- Risks or assumptions: comparison needs two complete trees, not full history; the reporter must remain the failing gate on new findings or missing/invalid scan data.
