# Locus Linux Readiness Plan

> This repo's slice of the canonical integration plan (`locus-os/development-docs/linuxIntegrationPlan.md`). If the two conflict, the canonical plan wins. Phases here are labeled R0–R5; the cross-repo phase gates are M0–M6.
>
> **Status legend:** each phase is `done`, `active`, or `not started`. Update statuses as work lands; record gate decisions in `locus/docs/decisions/`.

## R0 — Governance and fork-hygiene policy (maps to M0) — **done (2026-07-10)**

- Root `AGENTS.md` / `CLAUDE.md`; `locus/` directory with README, this plan, changelog, and skills.
- Policy established while the tree is still pristine: wrapper-first, additive-only Locus content, merge-based upstream sync, decision records before divergence.

## R1 — Base pinning (maps to M2 entry) — **not started; blocked on maintainer decision**

The tree currently sits on mainline v7.2-rc2 — a moving release candidate, unsuitable as a product base.

- Choose the newest **LTS** kernel tag available (verify LTS designation at kernel.org at decision time; do not base on mainline or `-rc`).
- Create the Locus working branch from that tag; document the choice, its support horizon, and the sync cadence in `locus/docs/decisions/`.
- Define the branch model: `master` mirrors upstream; the Locus branch = LTS tag + `locus/` layer only.

## R2 — Kernel configuration (maps to M2) — **not started**

- `locus/configs/locus-kiosk.fragment`: config fragment over the LTS `defconfig` for the kiosk target — DRM/KMS + virtio-gpu, input (evdev/libinput deps), sound (PipeWire deps), networking (NetworkManager deps), namespaces/cgroups (future app sandboxing), and nothing speculative.
- QEMU/virtio is the first-class target; one reference hardware target is deferred to M6.
- Validate with `scripts/kconfig/merge_config.sh` + a build of the merged config; record arch (x86_64 first).

## R3 — Image build pipeline (maps to M2) — **not started; blocked on builder decision**

- Choose the builder — decision record required. Candidates: **mkosi** over a mainstream base distro (pragmatic default: fast iteration, systemd-native, easy package pulls) vs **Buildroot** (minimal, fully source-built, more control, slower iteration). debos is the middle option.
- `locus/build/` produces a QEMU-bootable disk image: bootloader (systemd-boot) → pinned kernel → systemd userspace → `locus-session.service` → cage → chromium `--kiosk` with a dedicated persistent profile → `locus-shelld` (trivial static server) serving the locus-os production bundle from `http://localhost:<port>`. Never `file://` — it breaks origin/storage semantics.
- The locus-os bundle enters the image as a build input (built from a pinned locus-os ref), not a committed artifact.
- Exit criteria: `run-qemu.sh` boots to the Locus dashboard; user data survives reboot (persistent profile); image rebuild is reproducible from a clean checkout.

## R4 — CI (maps to M2 exit) — **not started**

- Workflow 1: merge + build the kernel config fragment (cacheable; kernel build only on fragment/base changes).
- Workflow 2: build the image and boot-smoke it in headless QEMU (serial console + a readiness probe against the shell server).
- Keep CI honest: a red boot-smoke blocks; no decorative badges.

## R5 — Native services era (maps to M3–M5) — **not started; placement decision open**

- `locus-cored` (object store + file bytes over localhost JSON-RPC first, then notifications/keyring/timers/AI provider) — whether it lives here under `locus/cored/`, in locus-os, or in a third repo is an open decision at M3 start.
- This repo's role regardless: packaging the daemon into the image, session wiring, and sandbox/isolation policy as manifests become real confinement.

## Upstream sync policy (from R1 onward)

- Merge (never rebase) from upstream stable tags of the pinned LTS series on a documented cadence (e.g., monthly or on security-relevant releases).
- After each sync: tree outside `locus/` + root docs must remain identical to the upstream tag (`git diff <tag> -- . ':!locus' ':!AGENTS.md' ':!CLAUDE.md'` is empty).
- Moving to a newer LTS series is a decision record, not a routine sync.

## Open decisions (blocking, in order)

1. LTS base version (R1).
2. Image builder (R3).
3. `locus-cored` placement (R5 / M3).
4. Reference hardware target (M6; QEMU-only until then).
5. Naming of the bootable form ("Locus Linux" vs "Locus OS").
