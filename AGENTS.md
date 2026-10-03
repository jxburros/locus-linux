# AGENTS.md - Locus Linux Agent Instructions

> Canonical repository instruction source. Tool overlays and shell instructions defer to this file for repository layout and kernel policy.

## 1. What this repository owns

Locus Linux contains the upstream Linux tree and the complete Locus userspace
source, Core contracts, tests, product specifications, and platform plan under
`locus/`. A separate web-app checkout is not required for reference, development,
or shell validation. The imported browser/PWA shell is in `locus/shell/`; a
bootable image and native Core daemon do not exist yet.

**Wrapper first, fork only on demonstrated need.** Locus is a distribution over
an unpatched kernel. Do not invent kernel work to implement userspace features.

## 2. Instruction hierarchy and required reading

1. The user's explicit request.
2. This file (repository boundaries and kernel policy).
3. `locus/shell/development-docs/coreIdentity.md` (binding identity constraints).
4. `locus/README.md`, `locus/docs/integration-plan.md` (canonical M0–M6 plan),
   and `locus/docs/readiness-plan.md` (R0–R5 image work).
5. For shell work: `locus/shell/AGENTS.md`, its development manifesto,
   architecture, product roadmap, and task-matched skills.
6. Upstream kernel conventions for approved kernel work.

Read the task-matched skills before changing their area:

- `locus/skills/locus-kernel-fork-hygiene/SKILL.md`: tree layout, branches,
  upstream sync, kernel work.
- `locus/skills/locus-image-boot/SKILL.md`: image, kernel configuration,
  session/boot, image CI.
- `locus/shell/skills/spec-driven-development/SKILL.md`: shell changes;
  additional shell skills are listed in its `AGENTS.md`.

## 3. Hard constraints

- Keep upstream kernel sources, Makefiles, Kconfig, Documentation, and other
  upstream paths pristine. Kernel patches require a maintainer-approved decision
  in `locus/docs/decisions/` before code changes.
- All Locus content lives under `locus/`, except root agent instructions. Existing
  repository automation outside that directory is not authorization to scatter
  more Locus files through the kernel tree.
- No binary blobs, built images, rootfs archives, model weights, `node_modules`,
  or built shell bundles in git. Text source assets are allowed.
- Upstream sync is merge-based from the selected stable/LTS series; never rebase
  published Locus branches or cherry-pick arbitrary mainline fixes.
- Preserve local-first operation, no default cloud/telemetry dependency,
  proposal-governed AI writes, brokered secrets, audit, and recoverable deletion.
- There is no approved kernel patch, chosen LTS base, or image builder. Record
  gate decisions before implementing those phases; do not present plans as code.

## 4. Change workflow

1. Read local governing documents and matching skills; inspect actual code/tests.
2. Make the smallest safe change within `locus/` and root agent docs.
3. Validate as below and report skipped or failed checks honestly.
4. Append to `locus/CHANGELOG.md` using `Agent: <Tool Name> (<Model Name>)`.
   For shell changes also append to `locus/shell/CHANGELOG.md`.
5. Update local README, architecture, plan, and skills when their claims change.
6. Work on a topic branch, not `master`. Never add an AI Signed-off-by tag.

## 5. Validation

From the repository root:

```sh
make -C locus shell-install
make -C locus shell-check
make -C locus shell-e2e  # needs Chromium; setup is documented in locus/README.md
```

- `shell-check`: typecheck, full unit suite, production build. No sibling checkout.
- `shell-e2e`: real-browser sandbox, widgets, multi-tab, and offline-PWA checks.
- Docs/skills-only edits: verify local paths and consistency; no kernel build.
- Kernel config: merge the fragment over target `defconfig`, build, record arch.
- Image pipeline: reproducible image build and headless QEMU boot to shell;
  record exact commands and evidence. A shell build is not a boot test.
- Verify the changed file list stays inside the permitted Locus boundary.

## 6. Reference ownership

`locus/docs/reference-guide.md` maps concepts to local specifications, executable
contracts, and tests. `locus/docs/shell-import.json` records the original source
commit and file hashes; it is provenance, not a remote dependency or sync job.
This repository's source and docs govern Linux work. Future shell changes are
made here; importing fixes from the old web repo is optional and reviewed.
No live instruction, image build, or test should require that repository.

Historical changelogs/audits describe earlier states and are not current policy.
Do not rewrite their history. The canonical platform plan takes precedence over
old phase claims; executable source/tests establish current shell behavior.

## 7. Current state

- Kernel version in this checkout: v7.2-rc2; no Locus kernel modifications in
  this change. LTS selection remains R1.
- R0 governance and self-contained shell/reference ownership are complete.
- R1–R5 image/native work remains unstarted. The existing dependency-scan
  workflow is not kernel/image build CI.
- Shell v0.6.0, its tests, and specifications are maintained in `locus/shell/`.
- No bootable image, native daemon, IPC backend, or native sandbox is claimed.
