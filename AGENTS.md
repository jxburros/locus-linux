# AGENTS.md - Locus Linux Agent Instructions

> Canonical AI-agent instruction source for this repository. `CLAUDE.md` and other tool overlays defer to this file.

## 1. What This Repository Is

Locus Linux is the operating-system layer of the Locus project: the vehicle for turning **Locus OS** (`jxburros/locus-os`, a local-first, AI-governed personal operating environment currently built as a browser PWA) into a bootable Linux-based operating system.

The tree is currently a **pristine, unmodified mirror of upstream Linux** (v7.2-rc2 at the time governance was added). Everything Locus-specific lives in exactly two places:

1. This file, `CLAUDE.md`, and other root-level agent/tool instruction files.
2. The `locus/` directory — docs, build configs, skills, and changelog.

**Policy: wrapper first, fork only on demonstrated need.** Locus Linux is a *distribution* built on an unpatched upstream kernel (the ChromeOS model: commodity kernel, custom userspace and shell). Do not patch kernel sources without an explicit maintainer decision recorded in `locus/docs/` — most Locus capabilities are userspace work.

## 2. Instruction Hierarchy

1. The user's explicit request.
2. This file.
3. `locus/README.md` and `locus/docs/readiness-plan.md`.
4. The canonical integration plan in the sibling repo: `locus-os/development-docs/linuxIntegrationPlan.md` (state assessments, target architecture, phase gates M0–M6).
5. Locus OS identity constraints (`locus-os/development-docs/coreIdentity.md`) — local-first, proposal-governed AI, no raw secret exposure, no silent destruction, honesty about scaffolds. They bind this repo too.
6. Upstream kernel development conventions, for any (approved) kernel-source work.

## 3. Required Reading Before Meaningful Changes

1. This file.
2. `locus/README.md` (layout and policy).
3. `locus/docs/readiness-plan.md` (what is planned, what phase is active).
4. The matching skill under `locus/skills/`:
   - `locus-kernel-fork-hygiene`: any change touching kernel sources, upstream sync, branches, or tree layout.
   - `locus-image-boot`: any work on kernel configs, image building, boot/session components, or CI for the bootable image.

## 4. Hard Constraints

- **Keep the upstream tree pristine.** No edits to kernel sources, Makefiles, Kconfig, Documentation, or any upstream path without a maintainer-approved decision record in `locus/docs/decisions/`.
- **All Locus content stays under `locus/` plus root agent docs.** No scattering of Locus files through the upstream tree.
- **No binary blobs in git** (images, rootfs archives, model weights). Build outputs are artifacts, not sources.
- **Upstream sync is merge-based from stable/LTS tags** on a documented cadence — never rebase published Locus branches over upstream, and never cherry-pick random mainline commits.
- **Nothing here may weaken Locus identity constraints**: the image must remain local-first (no default cloud dependency, no telemetry), AI writes stay proposal-governed, secrets stay brokered.
- **Do not invent kernel work.** There is currently no approved kernel patch, no chosen LTS base, no chosen image builder — see the open decisions in the readiness plan. Treat plan items as plans until promoted.

## 5. Change Workflow

1. Read the governing docs and matching skill.
2. Make the smallest safe change; keep Locus content additive and isolated.
3. Validate appropriately (see Section 6) or record why validation was skipped.
4. Append an entry to `locus/CHANGELOG.md` (same format as locus-os; identity `Agent: <Tool Name> (<Model Name>)`).
5. Update `locus/README.md` / `locus/docs/` if layout, policy, or plan state changed.
6. Report honestly, including anything incomplete or unvalidated.

## 6. Validation Expectations

- Docs/skills/config-fragment-text changes: no build required.
- Kernel config fragments: validate with `make defconfig` merged with the fragment (`scripts/kconfig/merge_config.sh`) once fragments exist; record the target arch.
- Image pipeline changes: the image must build reproducibly and boot in QEMU headless to the Locus shell; record the exact commands run.
- Any (approved) kernel-source change: the affected config must build; follow upstream patch hygiene (one logical change per commit, kernel commit-message style).
- Full kernel builds are expensive; do not run them for changes that cannot affect the build, and say so.

## 7. Relationship To locus-os

- `locus-os` owns the shell, Core services, AI governance, and their contracts; this repo consumes the built bundle and, in later phases, hosts native implementations of Core contracts (`locus-cored`).
- The canonical cross-repo plan lives in locus-os (`development-docs/linuxIntegrationPlan.md`); `locus/docs/readiness-plan.md` here is this repo's slice of it. If they conflict, the locus-os plan wins; flag the conflict.
- Cross-reference significant cross-repo work in both changelogs.

## 8. Current State (update when it changes)

- Tree: upstream Linux v7.2-rc2, zero divergence from `origin/master` apart from `locus/` and root agent docs.
- Active phase: M0 (governance) complete for this repo; M2 (LTS base pin, kernel config fragment, image pipeline, CI) is the next work here and is **not started**.
- No `.config`, no CI, no image tooling exists yet.

## Final Principle

Leave this repository boring: indistinguishable from upstream everywhere except `locus/`, with every divergence deliberate, documented, and reversible.
