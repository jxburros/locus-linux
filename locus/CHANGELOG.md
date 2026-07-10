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
