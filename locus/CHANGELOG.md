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
