# Locus Linux integration plan

> Canonical platform plan for this repository, reconciled on 2026-10-03.
> This replaces the old cross-repo plan as a live authority. Product identity,
> current shell architecture, design, and contracts are all local under
> `locus/shell/`. Future behavior below is not implemented unless explicitly stated.

## Direction and ownership

Build a distribution first: an unpatched upstream kernel plus minimal userspace
booting into the Locus spatial shell. Kernel changes require demonstrated need
and a decision record. A native compositor is a possible later investigation,
not a current requirement. The React shell can remain the long-term interface.

The shell, Core reference implementations, tests, and specifications are maintained
in `locus/shell/`. Image configuration and build tooling will live alongside it
under `locus/`. Future images build the shell from the same repository commit,
using its lockfile; they do not download or consult the former web-app repo.
[Decision 001](decisions/001-self-contained-locus-source.md) records this transfer.

## Current state and evidence

| Area | Implemented here | Remaining work |
|---|---|---|
| Shell | v0.6.0 React/TypeScript/Vite PWA, spatial workspace, apps and fourteen Cores; `shell/src/` | Kiosk-specific external-link and install-prompt policy |
| Governance | Typed Action Definition registry; Security gates at propose/approve/execute; broker, permissions, redaction, audit; tests alongside Cores | Daemon enforcement and native process confinement |
| Storage | localStorage session snapshots, IndexedDB recovery mirror, cross-tab locks; `storage.ts` and tests | Per-object transactional records, complete migration/recovery conformance; inherited intermittent concurrent-append loss (see changelog) |
| Files/media | OPFS → IndexedDB → memory byte store, Files grants at read time, import/download/playback, trash and purge; byteStore/Files/Media tests | Native file access, mounts/pickers, complete byte-inclusive backup/restore |
| Generated widgets | Dev authoring, validation/run/install/rollback, sandboxed widget RPC; unit and browser tests | Governed write RPC, dependency/toolchain runners, native sandbox |
| AI | Rule-based default plus explicit opt-in OpenAI-compatible endpoint dispatch; `modelRuntime.ts` and tests | Packaged on-device inference service; no live endpoint validation claimed |
| Kernel/image | Upstream kernel tree plus Locus layer; governance and shell development tooling | LTS selection, kernel fragment, image builder, boot/session services, QEMU evidence, image CI |

The original 2026-07-10 plan described metadata-only Files, no IndexedDB, no model
runtime, and no infrastructure tests. Those claims are superseded by the local
source and tests. Historical audits and changelogs retain their dates and scope.
Passing browser tests does not establish native-service or boot-image readiness.

## Target architecture

### Stage 1: bootable kiosk

```text
UEFI → systemd-boot → pinned LTS kernel + kiosk config
  → systemd userspace (seatd, NetworkManager, PipeWire)
  → locus-session.service → cage → Chromium kiosk
      → http://localhost:<fixed-port>/locus-os/
          ← locus-shelld serves locally built locus/shell/dist/
```

Use a dedicated persistent browser profile on the data partition. Keep the origin,
port, path, and profile stable across upgrades; changing them can strand browser
storage. Never use `file://`. Define external-link handling, suppress redundant
PWA install prompts, and test browser recovery. Do not disable Chromium's sandbox
in the product image (the test runner's container flag is not image policy).
Keep shell serving and future Core services separate so service failure can be
reported and the browser fallback remains usable. Local-first operation requires
no preinstalled accounts, telemetry, or default cloud services.

### Stage 2: native Core services

```text
Locus shell
  ⇅ authenticated local IPC (JSON-RPC initially; transport decision at M3)
locus-cored
  ├─ object store: SQLite/files
  ├─ file bytes: native access, scoped grants rechecked at open time
  ├─ secrets: keyring / Secret Service, secret:// references only
  ├─ notifications: freedesktop delivery + in-app history
  ├─ Time/Monitor: daemon timers, replacing tab election
  ├─ AI: opt-in local inference provider, cloud still opt-in
  └─ Broker/Security/Audit: same lifecycle, daemon-enforced
```

Loopback alone is not authorization. M3 must specify authenticated callers,
allowed origins, input validation, object/source scope, and denial/audit behavior
before exposing privileged operations. No daemon/IPC implementation exists today.

## Contract and translation ownership

[Reference guide](reference-guide.md) points to the local types, implementations,
and tests for every Core. The full concept translation table and portability rules
are in `shell/skills/locus-linux-translation/SKILL.md` and
`shell/skills/locus-platform-portability/SKILL.md` (paths relative to `locus/`).

- Keep state persistence behind `storage.ts` and bytes behind Files Core/byteStore.
- Treat the current synchronous cached-snapshot API as an existing constraint;
  design async IPC at these seams rather than spreading transport branches.
- `SystemObject`, app manifests, Action Definitions, and event payloads define the
  starting contracts. There is no versioned native RPC schema yet. Binary bytes
  and subscription callbacks need explicit transport representations.
- Preserve structural default-deny, repeated authorization at execution/open,
  secret references, redaction, append-only audit, and recovery semantics.
- Browser storage and offline operation remain supported when native services
  are unavailable. Do not retire tab coordination until a single daemon actually
  owns those responsibilities.

## Phased plan

Gates are evidence-based, not dates. No phase is completed by a documentation
import. R0–R5 in [readiness-plan.md](readiness-plan.md) break down image work.

### M0 — Foundations: implemented browser baseline and local governance

The imported stabilization implementation and its unit/browser suites are local.
Root governance and shell instructions no longer depend on another repository.
Keep registry claims true, all AI mutations governed, and local tests passing.
The import's actual validation results are recorded in `locus/CHANGELOG.md`.

### M1 — Storage headroom: partially delivered

Delivered: IndexedDB recovery mirror, OPFS/IndexedDB byte storage, real byte grants,
media playback, and test coverage. Remaining: per-object-type transactional records,
explicit migration/rollback and export/import coverage including byte payloads.
`storage.exportAll()` does not include file bytes; do not call it a full backup.
Exit: verified migration/recovery, state and byte round-trips, browser and future
native backend conformance, no silent loss or stale-source grants.

### M2 — Bootable kiosk image: not started

1. Record the LTS base and support horizon (R1), then the builder decision (R3).
   Candidates remain mkosi over a mainstream distro, Buildroot, or debos.
2. Add an x86_64 QEMU/virtio kernel fragment (R2): DRM/KMS, input, sound, networking,
   and justified namespaces/cgroups. Validate merge, build, and boot.
3. Build a reproducible image using this checkout's shell, pinned inputs,
   persistent data/profile, systemd units, compositor and local shell server.
4. Define and verify kiosk link/install/recovery policies in the local shell.
5. Add kernel/image build and headless QEMU smoke CI with serial logs and readiness
   probes (R4). A static HTTP 200 alone does not prove a usable rendered shell.

Exit: documented clean-checkout image build and `run-qemu.sh`; visible dashboard;
data survives reboot; offline operation; CI builds and boots with honest failures.
The old proposed `make -C locus image` command is not implemented yet. Existing
`make -C locus shell-build` builds only the browser bundle.

### M3 — First native service: not started

Record daemon placement (proposed `locus/cored/`), language, transport, and threat
boundary. Implement object storage and file bytes, then a backend at the existing
shell seams. Reuse and extend local tests as conformance tests against both
backends; in-browser jsdom success is not native conformance.
Exit: daemon-backed kiosk, equivalent grants/trash/recovery, authenticated IPC,
and a fully working standalone browser fallback.

### M4 — System integration: not started

Move Notification delivery to freedesktop, Secrets to keyring/Secret Service,
Time/Monitor to daemon timers, and audit to daemon-owned durable storage.
Exit: contract/denial/redaction/recovery tests pass for native implementations;
no tab elections where a daemon is authoritative; no weakening of governance.

### M5 — Packaged local inference: not started (browser adapter exists)

Reuse `modelRuntime.ts` routing/governance semantics and retain the rule-based
fallback. The v0.6.0 endpoint adapter is delivered; it does not mean an on-device
service is installed, configured, or validated in a Linux image.
Exit: a packaged local model answers reads and produces brokered proposals on the
image, with audited dispatch, failure fallback, and explicit opt-in for cloud.

### M6 — Product hardening: not started

Choose reference hardware after QEMU, an update/rollback strategy (A/B if warranted),
disk encryption and recovery, and real app/process sandboxing. Native compositor
work remains deferred. Define acceptance criteria from M2–M4 experience; any
kernel patch still needs its own decision record.

## Risks and open decisions

| Risk | Required mitigation |
|---|---|
| Kernel divergence | Isolated Locus tree, LTS pin, merge-based sync; documented patch decisions |
| Contract drift | Co-located types/source/tests; port against executable behavior |
| Storage loss | Persistent profile/origin, explicit migration/rollback, byte-inclusive backup |
| Stale imported prose | Local plan owns gates; current architecture owns implemented behavior; historical reports are dated evidence |
| Scope expansion | No native compositor/new Cores/daemon before corresponding gate decisions |
| Browser/native security mismatch | Explicit IPC authorization and conformance tests, not claims based on browser tests |

Open: LTS version/support horizon/sync cadence; image builder/distro; daemon
placement/runtime/IPC; reference hardware; update/encryption policy; final product
name. Shell source placement and reference ownership are resolved by decision 001.

Maintain this plan for gate decisions and direction changes; put routine progress
in `locus/CHANGELOG.md`. Update current shell architecture only for implemented
behavior. No remote plan overrides this file.
