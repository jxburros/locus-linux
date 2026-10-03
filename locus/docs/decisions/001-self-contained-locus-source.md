# 001 — Own the shell and its references in locus-linux

- Date: 2026-10-03
- Status: adopted for this change, implementing the user's request to make the
  Linux repository independent of the web-app repository for reference.
- Scope: source/reference ownership only; no kernel, LTS, image-builder, or daemon
  implementation decision is made here.

## Context

Linux instructions required a sibling repository for identity, the canonical
platform plan, Core contracts, design decisions, and future shell image inputs.
The old integration plan also lagged the actual v0.6.0 implementation. Copying only
summaries would leave maintainers dependent on another checkout for exact types,
behavior, regression evidence, and visual/source details.

## Options and decision

A link/submodule or pinned downloaded bundle preserves the external dependency.
A prose-only reference loses executable contracts. Import the complete tracked
text source for the shell, its tests, specs, available audits, historical changelog,
and skills into `locus/shell/`, then maintain them as ordinary local source.

Source: `jxburros/locus-os`, commit
`99de244663f82f1c21d2a40d95bb05c1b4a3b2b8` (v0.6.0), verified against `main` at
import time. [../shell-import.json](../shell-import.json) records original SHA-256
hashes for every imported file and the explicit omissions. Those hashes describe
the source baseline, not checksums that maintained local files must keep forever.
Authorship notices and history are retained. The source commit contained no
standalone license file; this import does not invent a new licensing declaration.

The canonical platform plan moves to `locus/docs/integration-plan.md`. The shell's
old plan path is a local navigation pointer. Root and shell agent instructions,
image skills, and readiness guidance now resolve locally. The browser package
remains isolated from kernel sources and has its own lockfile and ignored outputs.

## Import adaptations

- Preserve tests, TypeScript/Vite configuration, package and lockfile byte-for-byte.
  Core source is unchanged except replacing two literal NUL characters in
  `src/core/indexing.ts` with equivalent `\u0000` escapes so Git treats the
  source as reviewable text. No runtime Core behavior or native bridge is added.
- Update docs/skills to local ownership and reconcile outdated storage, Files,
  model-runtime, and validation claims with existing implementation.
- Unignore package-local `.codex/` and `.github/` guidance inside the shell
  package, overriding the kernel tree's blanket dot-directory ignore locally.
- Add `locus/Makefile` commands for dependency install, development, checks,
  production build/preview, and browser integration tests.
- Omit the old GitHub Pages deployment, CI, and dependency-scan workflows. A nested
  `.github/workflows` is inert, and copying them to the kernel root would violate
  the current Locus layout policy. Local commands retain their validation steps;
  live shell CI requires a future recorded layout-policy exception.
- Omit three binary PNG icons to comply with the no-binary-blob rule. Keep the
  original SVG icon, remove PNG manifest/precache/touch-icon references, and bump
  the worker cache version. Do not claim raster-only mobile icon support.
- Preserve `/locus-os/` as a URL base; it does not imply a source dependency. PWA
  origin/profile migration is not part of this change.

## Consequences and maintenance

The Linux repository now has executable references and can install, typecheck,
test, and build its own shell without reading another repository. Future image
builds consume local `locus/shell/dist/` and record the Linux repository commit.
Do not fetch the former repo as a build step or treat its docs as higher authority.

Changes here may diverge deliberately from the old web repository. Optional fixes
from it must be reviewed like any import, with local tests and a changelog entry;
there is no automatic sync. The source repo itself is unchanged by this import,
so no cross-repo release, deletion, archival, or paired changelog update is implied.

This grows the Locus userspace source tree but leaves upstream kernel files alone.
It does not make Linux bootable, complete M1 transactional storage, ship native
Cores, host inference, or replace QEMU/native acceptance tests with browser tests.

## Verification

The inherited concurrent-append browser test currently fails intermittently,
including persistent missing IDs in both tabs during diagnostics. This prevents
a clean browser release gate; the source-consolidation PR stays draft. No storage
runtime or original test assertions were changed to disguise that limitation.

Exact executed checks and results are recorded in `locus/CHANGELOG.md` and the
local shell changelog. Acceptance requires a locked local install, shell typecheck,
unit suite, production build, real-browser suite where available, resolved local
reference links, no generated/binary files staged, and no upstream changes.
