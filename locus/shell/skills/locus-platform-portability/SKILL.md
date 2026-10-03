---
name: locus-platform-portability
description: Keep Locus OS code portable toward its long-term Linux form (locus-linux). Use when changing anything under src/core/, adding browser API usage, adding dependencies, changing storage or persistence, designing or changing a Core API, or making any decision that could couple system logic to the browser runtime.
---

# Locus Platform Portability

Locus OS is currently a browser PWA, but its declared long-term direction is to become the shell and service layer of a Linux-based operating system (see `development-docs/linuxIntegrationPlan.md` and `../docs/integration-plan.md` relative to this shell package). The web app is the proof of concept **and** the reference implementation of the Core contracts that will later be re-hosted on Linux.

This skill exists so that code written today does not paint the Linux form into a corner. It does **not** ask you to build native bridges, abstractions for hypothetical backends, or speculative architecture — the smallest-safe-change rule from `AGENTS.md` still governs. It asks you to respect a small set of boundaries that are cheap to keep and expensive to recover.

## The layering rule

The dependency direction must stay:

```text
src/apps/ + src/components/   (React surfaces — browser-coupled, replaceable)
        ↓ may import
src/core/                     (system services — portable logic)
        ↓ may touch the platform ONLY through named seams
browser platform              (localStorage, DOM, service worker, WebCrypto, Notification API)
```

- Files under `src/core/` (including `src/core/cores/`) must not import from `src/apps/` or `src/components/`, and non-Provider core modules should not import React. React-coupled core files (`AppearanceProvider.tsx`, `hooks.ts`, `shell.ts`) are the explicit exceptions — they are the adapter layer between the store subscriptions and React, and new React coupling belongs next to them, not scattered through Cores.
- App and component code must not reach around a Core to the platform for behavior a Core owns (no direct `localStorage`, no ad-hoc `fetch`, no private persistence).

## Named platform seams

Browser APIs are allowed in core logic only through these seams. If you need a platform capability with no seam, extend the closest existing seam — do not inline the API call in a Core.

| Seam | File | Platform API behind it | Linux-form replacement (planned) |
|---|---|---|---|
| Persistence | `src/core/storage.ts` | `localStorage` + IndexedDB recovery mirror + `storage` event | local daemon store (SQLite/files) |
| File bytes | `src/core/byteStore.ts` via Files Core | OPFS → IndexedDB → memory fallback | native byte store behind Files Core grants |
| Object store | `src/core/objects.ts` | (via storage.ts) | daemon-owned object DB behind the same API |
| Secrets vault crypto | `src/core/cores/secrets.ts` | WebCrypto (AES-GCM, PBKDF2) | OS keyring / Secret Service; WebCrypto also exists in Node |
| Offline shell | `public/sw.js` | Service worker | irrelevant in kiosk/native session; keep isolated to `public/` |
| Notifications delivery | `src/core/cores/notification.ts`, `src/core/notifications.ts` | in-app only today | freedesktop notifications |
| External open | Web Core (`src/core/cores/web.ts`) | new-tab `window.open` | portal/default-handler launch |
| Platform targets / model routing | `src/core/platform.ts`, `src/core/cores/ai.ts`, `src/core/modelRuntime.ts` | explicit opt-in endpoint dispatch; platform table is scaffolded | local inference service / provider adapters |
| Cross-tab coordination | `storage.ts` subscriptions, scheduler/indexer election | native `storage` event | single daemon process makes this moot; do not deepen tab-election coupling casually |

## Core contracts must survive IPC

On Linux, Cores are expected to become out-of-process services (one daemon or per-Core services) consumed over IPC. A Core API survives that move only if its surface is already message-shaped. When you add or change a Core API:

1. **Inputs and outputs must be JSON-serializable.** No functions, class instances, DOM nodes, `Map`/`Set`, or React elements across a Core boundary. Callbacks are allowed only in the established subscribe/listener patterns — and their event payloads must themselves be serializable.
2. **No DOM or React types in Core signatures.** If a Core needs "what the user is looking at," it takes ids and plain descriptors, not elements or refs.
3. **Errors are values or typed failures, not UI behavior.** A Core reports failure; a surface decides how to render it (see the storage failure-honesty contract for the model).
4. **Events carry facts, not live objects.** Emit ids + minimal payloads; let consumers re-query.
5. **Capability manifests stay declarative data.** The AI permission model must remain expressible as plain data (`appRegistry.ts` manifests, `permissions.ts` overrides), because on Linux it becomes the input to portal-style prompts and per-app sandbox policy.

## Cheap habits that keep the door open

- Route every new persistence need through `storage.ts` and `StoreKeys` — never a new direct `localStorage` touch. (This is already repo law; on Linux it is also the entire migration surface.)
- Keep redaction at the existing choke points (`redactText` registrations) rather than per-surface — choke points port; scattered redaction does not.
- Keep time/scheduling logic inside Time Core rather than ad-hoc `setInterval` in apps — the scheduler is a daemon on Linux.
- When adding a dependency, prefer ones that run in both browser and Node/desktop runtimes; flag browser-only dependencies in your changelog entry.
- When something genuinely cannot be portable (e.g., service-worker behavior), keep it in the browser-only layer and say so in a comment or doc rather than letting it leak inward.

## What NOT to do

- Do not build native bridges, daemons, or Linux-specific branches inside this browser shell package. Native work is phase-gated in the local integration plan and belongs alongside it under `locus/`.
- Do not introduce speculative platform abstraction layers ("StorageBackendFactory") ahead of an actual second backend. The seam files themselves are the abstraction.
- Do not weaken local-first, proposal-governed AI, or audit behavior in the name of portability — those are identity constraints (`development-docs/coreIdentity.md`) and they port as-is.

## Review checklist

Before finishing a change, confirm:

- [ ] No new `window`/`document`/`navigator`/`localStorage` access outside `src/apps/`, `src/components/`, or a named seam file.
- [ ] No new React/DOM imports inside `src/core/cores/` or non-Provider core modules.
- [ ] New/changed Core APIs take and return JSON-serializable values; event payloads are serializable.
- [ ] New persistence goes through `storage.ts` + `StoreKeys`.
- [ ] Any unavoidable browser-only behavior is isolated and documented.
- [ ] `npm run typecheck` and `npm test` pass (see the `locus-validation-loop` skill).
