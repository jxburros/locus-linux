# Locus Linux

This repository owns the Locus shell, its Core services and tests, product and
design specifications, and the plan for turning them into a bootable Linux OS.
**You do not need the former web-app repository to develop or reference Locus.**

The kernel remains an upstream tree. All Locus implementation lives here under
`locus/`; root `AGENTS.md` defines the boundaries. The current deliverable is a
working browser/PWA shell, not a bootable Linux image.

## Start from this checkout

Requirements: Node 20.19+ (Node 22.12+ or 24 recommended), npm, and make for the
convenience targets. npm downloads locked dependencies; running the shell does
not require an account, cloud provider, or another repository.

```sh
make -C locus shell-install
make -C locus shell-dev
# Open http://localhost:5173/locus-os/
```

`/locus-os/` is a preserved URL base, not a repository dependency. Keeping it
avoids unnecessary changes to PWA scope and origin-relative assets. Never serve
this bundle via `file://`; storage and service workers need a localhost origin.

```sh
make -C locus shell-check    # typecheck + all unit tests + production build
make -C locus shell-preview  # after building: http://localhost:4173/locus-os/
make -C locus shell-e2e      # real Chromium: sandbox, widgets, multi-tab, offline
```

For browser tests, first run `cd locus/shell && npx playwright install chromium`.
On minimal Linux hosts use `npx playwright install --with-deps chromium` where
system-package installation is available. A provisioned browser can instead be
selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium`.
The e2e suite starts its own servers on ports 4173/4174; stop preview first.

Without make, run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm run test:e2e` from `locus/shell/`. The lockfile and npm project are local to
that directory. Production output is `locus/shell/dist/` and is ignored by git.

Known inherited validation defect: the concurrent-append browser test sometimes
observes missing records in both tabs (latest full run: 10 passed, 1 failed).
Typecheck, all 497 unit tests, and the production build pass. Do not treat an
occasional green browser rerun as proof this storage issue is resolved. Exact
validation and diagnostic evidence are recorded in [the changelog](CHANGELOG.md).

## Local source of truth

- [Reference guide](docs/reference-guide.md): concepts → specifications, code,
  and tests; start here before porting a Core.
- [Core identity](shell/development-docs/coreIdentity.md): binding user-control,
  local-first, privacy, and AI governance rules.
- [Architecture](shell/development-docs/architecture.md): current shell behavior.
- [Design language](shell/development-docs/design.md): complete spatial-shell and
  visual specification, with tokens/components in the same checkout.
- [Integration plan](docs/integration-plan.md): canonical M0–M6 target architecture
  and acceptance gates, reconciled with the imported implementation.
- [Readiness plan](docs/readiness-plan.md): kernel/image R0–R5 work and open decisions.
- [Import decision](docs/decisions/001-self-contained-locus-source.md): provenance,
  ownership, import scope, adaptations, and maintenance policy.

## Layout

```text
locus/
├── README.md, CHANGELOG.md, Makefile
├── docs/
│   ├── integration-plan.md, readiness-plan.md, reference-guide.md
│   ├── shell-import.json             # original commit + per-file hashes
│   └── decisions/                    # deliberate architecture/gate decisions
├── skills/                           # kernel hygiene and image/boot workflow
└── shell/
    ├── src/, public/, e2e/            # shell, Core implementations, tests, assets
    ├── development-docs/              # identity, architecture, design, roadmap
    ├── skills/, .codex/skills/        # local contribution/portability/safety skills
    ├── package.json, package-lock.json
    └── AGENTS.md, README.md, CHANGELOG.md
```

`configs/`, `build/`, and `cored/` are future components, not existing tooling.
The intended boot chain is pinned LTS kernel → systemd → cage → Chromium kiosk
→ locally served build of `shell/`. A dedicated persistent browser profile is
mandatory. Later native services re-host the local Core contracts with stronger
process isolation. Neither stage authorizes weakening existing governance.

## Limits and next work

The former repo's source and tests are included, not a submodule or downloaded
bundle. No upstream kernel code was changed. No LTS, builder, or reference hardware
has been chosen, and no image boot has been verified. R1 base selection and R3
builder decisions remain the next image prerequisites.

Imported tests run locally through the targets above. The existing root dependency
scan does not validate the shell or an image. A runnable shell CI workflow has not
been installed: GitHub discovers workflows only at the repository root, outside
the current permitted Locus tree. Record a layout-policy decision before adding it.

Only the text SVG icon is carried over; raster-only home-screen icon support
(including Apple's PNG touch icon) is not claimed. Offline shell behavior is tested
in Chromium. Image builders should use this checkout's `shell/dist/` and record
this repository's commit in image metadata; they must not fetch the old web repo.
