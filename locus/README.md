# locus/ — The Locus Linux Layer

This directory is the **only** place (besides root agent-instruction files like `AGENTS.md` and `CLAUDE.md`) where Locus-specific content lives in this repository. Everything outside it is pristine upstream Linux and must stay that way — see `AGENTS.md` for the hard constraints and `locus/skills/locus-kernel-fork-hygiene/SKILL.md` for the working rules.

## What Locus Linux is

Locus Linux is the operating-system layer of the Locus project. The end state is a bootable Linux-based OS whose entire user experience is **Locus OS** (`jxburros/locus-os`) — a local-first, AI-governed personal operating environment currently proven as a browser PWA.

The approach is **wrapper first, fork only on demonstrated need**:

- Stage 1 (kiosk): upstream kernel + minimal userspace (systemd, seatd, NetworkManager, PipeWire) booting into a Wayland kiosk compositor (cage) running a browser shell that loads the Locus OS bundle full-screen from a local origin.
- Stage 2 (native services): a local daemon (`locus-cored`) hosts the Core service contracts natively — SQLite/file storage, real file bytes, freedesktop notifications, keyring-backed secrets, daemon timers, and a local AI inference provider — while the same shell consumes them over IPC.

The canonical cross-repo plan (state assessments, target architecture, phase gates M0–M6, risks, open decisions) is `development-docs/linuxIntegrationPlan.md` in the locus-os repository. This repo's slice of it is `locus/docs/readiness-plan.md`.

## Directory layout

```text
locus/
├── README.md                    - This file: purpose, layout, policy summary.
├── CHANGELOG.md                 - Append-only log of meaningful Locus-layer work.
├── docs/
│   ├── readiness-plan.md        - This repo's readiness phases (R0–R5) and open decisions.
│   └── decisions/               - Decision records (required before any kernel patch,
│                                  base pin, or builder choice). Empty until decisions are made.
├── skills/
│   ├── locus-kernel-fork-hygiene/SKILL.md
│   └── locus-image-boot/SKILL.md
├── configs/                     - (Planned, R2) Kernel config fragments for Locus targets.
└── build/                       - (Planned, R3) Image build pipeline + QEMU boot scripts.
```

`configs/` and `build/` do not exist yet; they are created when their phases start.

## Policy summary

- Upstream tree stays byte-identical to upstream; sync by merging stable/LTS tags.
- Kernel patches require a decision record in `locus/docs/decisions/` first.
- No binary blobs in git.
- The image inherits Locus OS's identity constraints: local-first, no telemetry or cloud dependency by default, AI writes proposal-governed, secrets brokered.
- Meaningful work appends to `locus/CHANGELOG.md`.
