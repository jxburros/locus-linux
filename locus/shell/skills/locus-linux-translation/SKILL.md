---
name: locus-linux-translation
description: Understand how each Locus OS concept maps to the future Linux-based form (locus-linux) before making design decisions. Use when working on integration-plan items, platform or packaging decisions, native/OS-adjacent features (files, notifications, secrets, sandboxing, model runtime), or when unsure whether a design choice would survive the move to Linux.
---

# Locus → Linux Translation Map

Locus OS has a declared long-term direction: the current browser PWA becomes the shell and service layer of a Linux-based operating system, developed in this repository, with shell source under `locus/shell/`. The canonical plan, phases, and current phase status live in `../docs/integration-plan.md` (relative to the shell package) — read the "Phased plan" section there before acting on anything in this skill.

This skill is the concept-by-concept translation table. Use it to answer one question while working in this repo today: **"what does this feature become on Linux, and does my change keep that path open?"**

## The two target stages

Translation happens in two distinct stages. Do not conflate them:

1. **Kiosk stage ("wrapper").** A minimal Linux userspace boots straight into a Wayland kiosk compositor (e.g. cage) running a browser shell that loads the Locus OS bundle full-screen. The web app IS the OS shell, unchanged. Almost everything in this repo ports as-is; image work lives alongside this package under `locus/`.
2. **Native-service stage.** Core services move out of the browser into a local daemon (`locus-cored`) with real storage, real file bytes, OS notifications, keyring-backed secrets, and a local model runtime. The React shell keeps its role but consumes Cores over IPC. This is where today's contract discipline pays off or fails.

## Translation table

| Locus concept (this repo) | Kiosk stage | Native-service stage |
|---|---|---|
| Spatial shell (`components/desktop/`, `core/desktop.ts`) | Unchanged — the browser is full-screen; the shell is the only UI | Same React shell at first; a native Wayland compositor implementing the same tile/Focus model is a far-future option, not a commitment |
| Persistence (`core/storage.ts`, localStorage + IndexedDB recovery mirror) | Unchanged, but quota/eviction risks shrink (dedicated profile) | Daemon-owned store (SQLite + files under `~/.local/share/locus`); `storage.ts` becomes an IPC-backed implementation of the same API |
| `SystemObject` store (`core/objects.ts`) | Unchanged | Owned by the daemon; same API surface, different transport |
| Cores (`core/cores/*`) | Unchanged, in-browser | Out-of-process services; the TS modules are the reference implementations of the IPC contracts |
| Core events (`core/events.ts` bus) | Unchanged | IPC signals/subscriptions — payloads must stay serializable |
| Capability manifests + tiers (`appRegistry.ts`, `permissions.ts`) | Unchanged | Input to portal-style permission prompts and per-app sandbox policy (XDG-portal / Flatpak-permission analogy) |
| Broker propose→approve→execute (`broker.ts`, `cores/security.ts`) | Unchanged | Identical lifecycle, daemon-enforced; approval UI may also surface as system dialogs |
| Audit log (`core/audit.ts`) | Unchanged | Append-only log owned by the daemon (file/DB), same append-only and no-silent-clear rules |
| Secrets vault (`cores/secrets.ts`, WebCrypto) | Unchanged | Backed by the OS keyring / Secret Service API; the `secret://` reference indirection and redaction choke points survive unchanged |
| Files Core (metadata + OPFS/IndexedDB bytes) | Unchanged (real local bytes) | Real filesystem access via the daemon; one-shot grants become real open-time grants; trash maps to XDG trash or daemon-managed trash |
| Media Core | Unchanged | Native byte access preserves current playback; thumbnails remain future |
| Notification Core | Unchanged (in-app shade) | freedesktop notifications; quiet hours map to system DND; the in-app shade remains the history surface |
| Web Core (new-tab shortcuts) | Kiosk needs an explicit policy: external URLs open in a controlled window, not tabs | Default-handler / portal launches |
| AI Core + opt-in endpoint runtime (`cores/ai.ts`, `modelRuntime.ts`) | Unchanged (rule-based default; endpoint dispatch only when configured) | Local inference service (e.g. llama.cpp-class runtime) as just another provider behind AI Core routing; cloud providers stay explicit opt-in |
| Time Core scheduler (elected tab) | Single kiosk tab makes election trivial | Daemon timer (systemd timer-style); tab election disappears |
| Cross-tab coordination (`storage` events, elections) | Mostly moot (one tab) | Entirely moot (one daemon) — avoid deepening this machinery |
| Service worker / PWA (`public/sw.js`, manifest) | Redundant (bundle ships in the image) but harmless | Browser-form-only artifact; keep isolated in `public/` |
| Onboarding/install prompts | Suppress/adapt in kiosk profile | N/A |

## Decision guide

When a task touches one of these areas, check three things:

1. **Which stage owns the work?** Anything requiring a daemon, IPC, kernel, image build, or compositor belongs outside this shell package under `locus/` and is phase-gated — do not build it inside browser Cores. What belongs here now is contract discipline (see the `locus-platform-portability` skill) and the storage-backend migration when it is promoted on the roadmap.
2. **Does the contract survive the table's right-hand column?** If your API change would break under "same API, different transport" (non-serializable payloads, DOM types, synchronous assumptions that only localStorage can honor), redesign it now — it is cheap today and a migration blocker later. Note: the current storage API is synchronous; the future backend move (IndexedDB/daemon) will force an async or cached-snapshot pattern at the `storage.ts` seam. Do not add *new* deep dependencies on synchronous read-after-write behavior outside that seam.
3. **Does it preserve the identity constraints?** Local-first, proposal-governed AI writes, no raw secret exposure, audit continuity (`development-docs/coreIdentity.md`). These are non-negotiable in both forms — the Linux form makes them *stronger* (real sandboxing, real keyring), never weaker.

## Anti-goals

- Do not fork behavior ("if linux then …") inside this repo. There is no Linux runtime here to detect; keep one code path and clean seams.
- Do not add Electron/Tauri/Capacitor wrappers as a shortcut to "native" — the declared direction is a bootable Linux image, and the multi-platform-release skill governs any interim packaging separately.
- Do not treat this table as license to implement future-phase capabilities. Roadmap promotion rules in `development-docs/productRoadmap.md` still apply.
