---
name: locus-kernel-fork-hygiene
description: Keep the locus-linux tree a clean, low-maintenance layer over upstream Linux. Use when touching anything outside locus/ (kernel sources, Makefiles, Kconfig, Documentation), syncing with upstream, creating branches, moving the base version, or deciding where new Locus content should live.
---

# Locus Kernel Fork Hygiene

This repository's value is that it is boring: pristine upstream Linux plus one additive `locus/` layer. Every rule here exists to keep the upstream diff surface at (or as near as possible to) zero, because kernel-fork drift is a permanent maintenance tax that compounds with every upstream release.

## The prime directive

Outside `locus/` and the root agent docs (`AGENTS.md`, `CLAUDE.md`), this tree must remain byte-identical to the upstream tag it is based on. Verify at any time:

```bash
git diff <upstream-tag> -- . ':!locus' ':!AGENTS.md' ':!CLAUDE.md'   # must be empty
```

If a task seems to require editing an upstream file, stop: either the change belongs in `locus/` (config fragments, build tooling, docs), or it is a genuine kernel patch — which requires a maintainer decision record in `locus/docs/decisions/` **before** any code is written.

## Where things go

| Content | Location |
|---|---|
| Docs, plans, policy | `locus/docs/` |
| Decision records | `locus/docs/decisions/NNN-<slug>.md` (context, options, decision, consequences) |
| Kernel config fragments | `locus/configs/` (fragments over defconfig — never a full `.config`, never editing upstream defconfigs) |
| Image/build tooling | `locus/build/` |
| Skills | `locus/skills/` |
| Changelog | `locus/CHANGELOG.md` |
| Approved kernel patches (if ever) | An identifiable, minimal commit series on the Locus branch, each referencing its decision record; consider `locus/patches/` mirrors so the divergence is enumerable |

Never: Locus files sprinkled through upstream directories, edits to upstream Documentation/README, "cleanups" of upstream code, or binary blobs anywhere in git.

## Branch and sync model

- `master` mirrors upstream mainline — never commit to it.
- The Locus working branch = pinned base tag + the `locus/` layer (+ any approved patch series).
- **Base on an LTS tag, not mainline `-rc`** (R1 in `locus/docs/readiness-plan.md`; currently an open decision — do not pick one yourself).
- Sync by **merging** upstream stable tags of the pinned series on the documented cadence. Never rebase published Locus branches; never cherry-pick assorted mainline commits ("just this one fix" is how drift starts — wait for it in stable).
- After every sync, re-run the prime-directive diff and record the sync in `locus/CHANGELOG.md`.
- Moving to a newer LTS series is a decision record, not a routine sync.

## If a kernel patch is ever approved

Follow upstream discipline so the patch stays upstreamable and rebasable:

- One logical change per commit; kernel commit-message conventions (subsystem prefix, imperative, wrapped body, `Signed-off-by` if it may go upstream).
- Run `scripts/checkpatch.pl` on the series; build the affected config(s).
- Prefer getting the change into upstream and dropping the local patch — the goal is always to return to zero divergence.

## Validation

- Docs/skills-only changes under `locus/`: no build; say so in the changelog entry.
- Config fragments: merge with `scripts/kconfig/merge_config.sh` and build the result (record arch and config used).
- Anything touching upstream files: full prime-directive diff + build of the affected config, plus the decision-record reference in the commit message.

## Red flags to refuse or escalate

- A request to "fix" or reformat upstream code without a decision record.
- Adding a driver, feature flag, or sysctl "while we're here."
- Rebasing the Locus branch onto a new base without a decision record.
- Committing a built image, rootfs tarball, or `.config` at the tree root.
