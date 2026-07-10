---
name: locus-image-boot
description: Build and boot Locus Linux correctly — kernel config fragments, the bootable kiosk image, the boot-to-shell session chain, and image CI. Use when working under locus/configs/ or locus/build/, changing the session/userspace composition, integrating the locus-os bundle, or setting up QEMU/CI boot testing.
---

# Locus Image and Boot

This skill governs how Locus Linux becomes a bootable OS whose entire user experience is the Locus OS shell. Phases and open decisions live in `locus/docs/readiness-plan.md` (R2–R4) — check phase status before building anything; as of R0 none of this tooling exists yet, and the builder/base decisions are open.

## The target boot chain (Stage 1, kiosk)

```text
systemd-boot → kernel (pinned LTS + locus-kiosk fragment)
  → systemd userspace (seatd, NetworkManager, PipeWire)
  → locus-session.service
      → cage (Wayland kiosk compositor)
          → chromium --kiosk --app=http://localhost:<port>  (dedicated persistent profile)
              ← locus-shelld: static server serving the locus-os production bundle
```

Design rules that are not negotiable:

- **The bundle is served from a localhost origin, never `file://`** — `file://` breaks origin semantics, storage, and the app's assumptions.
- **The browser profile is dedicated and persistent** — user data currently lives in web storage; losing the profile is losing the user's data. The profile location must be on the persistent data partition and covered by any future backup story.
- **The locus-os bundle is a build input, not a committed artifact**: built from a pinned locus-os git ref during image assembly. Record the ref in the image metadata.
- **Kiosk policy is explicit**: no tabs, no browser chrome, defined external-link behavior, PWA install prompts suppressed. Coordinate anything needing app-side support with locus-os (see its `locus-linux-translation` skill).
- **Identity constraints bind the image**: no telemetry, no default cloud services, no preinstalled accounts. Network exists for the user's explicit use, not the system's.

## Kernel config fragments (`locus/configs/`)

- Fragments over the arch `defconfig`, merged with `scripts/kconfig/merge_config.sh` — never a hand-maintained full `.config`, never edits to upstream defconfigs.
- One fragment per target, minimal and commented: every `CONFIG_` line should say why Locus needs it (DRM/KMS + virtio-gpu for the compositor; evdev/libinput input; PipeWire audio deps; NetworkManager deps; namespaces/cgroups for future app sandboxing).
- QEMU/virtio is the first-class target; real hardware waits for M6. x86_64 first.
- Validate: merge + build + boot the result in QEMU before claiming a fragment works.

## Image pipeline (`locus/build/`)

- Builder choice (mkosi vs Buildroot vs debos) is an open decision requiring a record in `locus/docs/decisions/` — do not pick silently.
- Whatever the builder: reproducible from a clean checkout, inputs pinned (package versions or lockfiles where the tool allows, locus-os ref, kernel tag), outputs to a git-ignored directory, no binary blobs committed.
- Provide `locus/build/run-qemu.sh` so a fresh contributor can go from checkout to booted shell in a couple of commands (documented in `locus/README.md` when it lands).
- Keep the userspace minimal: every package in the image should be traceable to a boot-chain need. Bloat is a security surface and an update cost.

## Boot testing and CI (R4)

- Headless QEMU boot-smoke: serial console logging, wait for `locus-session` up, probe the shell server (HTTP 200 on the bundle) — screenshot/GPU checks are a later nicety, not the gate.
- CI builds: (1) merged-config kernel build on fragment/base changes; (2) image build + boot-smoke on `locus/build/` changes. Cache aggressively; a red boot-smoke blocks merge.
- Never mark a boot path "working" that was not actually booted — record exactly what was run (QEMU command line, image hash) in `locus/CHANGELOG.md`.

## Stage 2 hooks (do not build early)

When native services begin (M3+): `locus-cored` gets its own systemd unit and talks to the shell over localhost IPC; the shell server and daemon stay separate units so the shell remains usable if the daemon is down (browser-storage fallback). Package sandboxing (per-app confinement realizing the capability manifests) is M6-era work. None of this starts without the phase gate and placement decision.
