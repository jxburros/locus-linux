# Locus shell

This is the maintained shell package inside `locus-linux`, imported with its
Core contracts, tests, and specifications. Run all commands below from
`locus/shell/`. See [the parent README](../README.md) for one-checkout commands
and [the local reference guide](../docs/reference-guide.md) for native porting.
No sibling web-app repository is required. Historical audits/changelog entries
are retained; current platform gates are in [the integration plan](../docs/integration-plan.md).

The `/locus-os/` URL base is deliberately preserved. Only SVG source icons are
shipped here; PNG-only mobile home-screen icon support is not claimed. Imported
Pages/deployment workflows are not installed in this package.

A **local-first, AI-native personal operating environment** that runs in the browser and installs as a PWA on Android, desktop, or anywhere Chrome runs.

Locus is not a clone of Windows, macOS, or Android. It's a custom OS *shell* built around a **spatial operating surface**: a fixed, non-scrolling workspace of placed tiles on a dense unit grid — not an empty icon field, a pile of overlapping windows, or a scrolling dashboard. Placement feels nearly freeform; snapping, alignment guides, and shared borders keep it precise — tiles resize from **any side or corner**, and dragging a shared border moves it for both tiles. There is no fixed chrome — the **header is itself made of tiles**: one or more customizable edge segments (on any edge, even several at once) rendering an ordered list of header items. Five controls are required and can never all be deleted — the logo (always returns to the Dashboard), the Dashboard ↔ Focus switcher, Freeform, Apps, and Settings — everything else can be added, moved, or removed. Focusing a tile transforms the layout in place: it grows into a large slot while every other tile compresses around it, and leaving Focus restores the arrangement — you never navigate away. Underneath the apps sits a **Core Services layer** (the Custom OS Core System Directive, developed against the Core API Focus List): fourteen shared Cores — Time, Cardspoke, Editor, Files, Search/Index, People, Monitor, Web, AI, Secrets, Security, Notification, Media, and Dev — that own major capabilities so apps are surfaces over shared systems instead of silos. On top of that sit an app registry, a command palette, a shared object model, an indexer, an explicit AI permission model, an AI broker with an approval queue, and a local audit log — built around three commitments:

1. **Local-first.** Every byte of your data lives on your device (currently `localStorage`, structured so it can move to IndexedDB or a synced backend without touching any app).
2. **One object, many apps.** Documents, cards, tasks, projects, files, and memory are all `SystemObject`s in one store. Apps are lenses onto that store, so Search finds everything and Projects can link anything.
3. **Actions are the security boundary.** Reading and indexing are broad inside a connected scope; *writing* is not. Apps *declare* what an AI could do; *you* decide per capability where the line sits, and every change the AI makes flows through an approval queue and the audit log.

The name "Locus" is a placeholder — you can rename the whole environment in **Settings → System name**.

---

## Validation limitation in this import

The inherited concurrent-append e2e test intermittently loses records across two
tabs, including after waiting for storage propagation. The latest unmodified
browser suite reports 10 passed / 1 failed; typecheck, 497 unit tests, and build
pass. See [the import changelog](../CHANGELOG.md). This is not a clean browser
release gate and has not been hidden by changing assertions.

## Quick start

```bash
npm ci
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/locus-os/`). That's it.

To build and preview a production bundle (this is what enables the PWA/service worker):

```bash
npm run build
npm run preview
```

Other scripts: `npm run typecheck` runs the TypeScript project build with no emit. `npm test` runs the Vitest suite for the Core Services layer (`src/core/cores/*.test.ts`); `npm run test:watch` reruns it on change. `npm run test:e2e` runs the Playwright real-browser integration suite (`e2e/` — the Dev sandbox, the devwidget tile runtime, multi-tab persistence, and offline-PWA launch that jsdom cannot exercise; needs a Chromium, via `npx playwright install chromium`).

**Requirements:** Node 20.19+ and npm (the test tooling — Vitest 4 / jsdom 29 — requires it; enforced by `engines` in `package.json`). No other global tooling.

### Installing as a PWA

Run the production build (`npm run build && npm run preview`) and open it in Chrome. You'll get an install prompt (or use the address-bar install icon / *Add to Home screen* on Android). Once installed it launches standalone and works offline — the app shell (HTML, manifest, icons) is precached on install and the hashed JS/CSS bundles are cached at runtime on the first online load, so subsequent launches work offline. Since all data is local, offline is the normal case rather than a fallback.

---

## Architecture

The whole system is organized around two ideas: a **shell** that provides OS chrome and navigation, and a **registry of app modules** that the shell renders. Nothing about an app is hard-coded into the shell — the registry is the single source of truth.

```
src/
  main.tsx              # entry: boot storage, seed stores, mount providers, register SW
  core/                 # the "kernel" — no UI, just system services
    storage.ts          # namespaced local persistence + IndexedDB durable mirror + cross-tab locks
    actionRegistry.ts   # typed Action Definition registry (the structural authorization contract)
    theme.ts            # appearance model (theme/accent/density/system name)
    AppearanceProvider.tsx  # live appearance context
    audit.ts            # append-only local event log (the transparency spine)
    objects.ts          # THE object store: one SystemObject array, shared by every app
    workspace.ts        # spatial workspace layouts (Anchors, spans, AI context scope)
    permissions.ts      # declared capabilities + user overrides -> effective permissions
    aiContext.ts        # assembles the AIContextPacket ("what the AI may read now")
    byteStore.ts        # file BYTES seam: OPFS → IndexedDB → memory, one payload per file id
    assistant.ts        # local rule-based assistant: read → answer, write → proposal
    broker.ts           # AI Broker: propose → approve/deny → execute lifecycle + trusted actions
    credentials.ts      # Credential Broker: exposes scoped capabilities, never raw secrets
    sources.ts          # connected sources: readable/indexable scopes + exclusions
    indexing.ts         # on-demand indexer over objects; metadata summaries; index status
    platform.ts         # platform targets + model-routing table (phase-9 seam)
    appRegistry.ts      # THE app registry: one array of AppModule objects
    desktop.ts          # the desktop store: placed tiles, modes, workspaces, scratchpad, widgets, header
    tileMeta.ts         # tile geometry/metadata + the dense unit grid (GRID_W × GRID_H)
    surface.ts          # surface geometry: edge-widget bands, usable area, unit→px projection
    snap.ts             # snapping + guides: edges, centers, equal gaps, equal sizes
    focusLayout.ts      # Focus as a projection: focused tile grows, the rest compress
    commands.ts         # command-palette commands (apps + workspaces + system)
    shell.ts            # ShellContext definition + useShell hook
    hooks.ts            # useNow / useMediaQuery / useStoredValue / useObjects
    cores/              # THE CORE SERVICES LAYER (Core API Focus List)
      registry.ts       # all 14 Core definitions: focus, owns, events, AI path, boundary, status
      time.ts           # Time Core: alarms/timers/events/reminders + trigger scheduler + describeUpcoming
      cardspoke.ts      # Cardspoke Core (from the CardSpoke app's kernel): [[wiki-links]] + backlinks,
                        #   related-by-tags, reversible conversions, outline→tasks, saved filters
      editor.ts         # Editor Core: undo/redo, selection, transformations, diff previews, AI edit transactions
      files.ts          # Files Core: metadata + real local bytes (byteStore), import/download, recents,
                        #   trash/restore, source grants, brokered access (grants release real bytes)
      searchIndex.ts    # Search/Index Core: query grammar (type:/tag:/before:/after:), ranking,
                        #   relationship discovery, redacted context snippets for AI
      people.ts         # People Core: contacts, groups, interaction channels + per-contact cadence (Pal-Plant model)
      monitor.ts        # Monitor Core: watches (incl. stale items) + evaluator loop + snooze + history
      web.ts            # Web Core: web app/PWA shortcuts, permissioned page context, page watches
      ai.ts             # AI Core: routing table + model routing rules (Model Traffic Manager pattern)
      secrets.ts        # Secrets Core: secret:// refs, brokered use, existence checks for AI, leak detection
      security.ts       # Security Core: risk levels, trusted actions, sandbox policy, manifest evaluation
      notification.ts   # Notification Core: delivery (priority, snooze, quiet hours, grouping, history)
      media.ts          # Media Core: kind detection (magic numbers over real bytes), playback support,
                        #   Blob-URL playback (mediaUrlFor), metadata over the file store
      dev.ts            # Dev Core: code artifacts + manifests + diffs + validation + sandboxed
                        #   execution (isolated iframe) + install/rollback + provenance + the
                        #   devwidget runtime (manifest-gated RPC for installed widgets)
  components/            # the shell chrome
    Shell.tsx           # keyboard shortcuts + ShellContext; mounts the one surface
    CommandPalette.tsx / ui.tsx / chrome.css
    desktop/            # the spatial operating surface
      Workspace.tsx     # fixed non-scrolling surface: placement, drag/resize + guides, Focus
      TileFrame.tsx     # the chrome around every tile; presentation modes (full→icon)
      TileMenu.tsx / TileSettingsDialog.tsx / FreeformBar.tsx / Onboarding.tsx / dnd.ts
    tiles/              # tile content components (incl. the Home edge widget)
    anchors/            # compact live anchor previews for registry apps
  apps/                 # each app = a component + a capability manifest
    writer/ cards/ tasks/ projects/ files/ search/ assistant/
    time/ monitor/ vault/ people/ web/ cores/
    ai-control/ sources/ settings/ audit-log/ platform/
  types/                # app / permissions / audit / objects / workspace / ai (+ barrel)
  styles/               # tokens.css (design tokens) + globals.css (reset + atoms)
public/                 # manifest.webmanifest, sw.js, icons/
```

### Data flow

- **Persistence.** Everything goes through `core/storage.ts`, a thin typed key/value wrapper over `localStorage` (namespaced under `locus:`) backed by a write-behind **IndexedDB durable mirror**: every write is mirrored with a monotonic per-key revision, and boot hydration restores anything `localStorage` lost — a cleared/evicted key, or a quota-failed write only the mirror captured — before seeding runs. `storage.update()` serializes read-modify-write under a cross-tab Web Lock, so two tabs can't lose each other's records. Storage failures are honest: corrupt values are preserved under a backup key, quota failures surface as a critical notification, a **Safe mode** surface offers export / per-store reset / retry instead of a blank page, and **Settings → Storage → Export all data** downloads everything as one JSON file (vault values stay encrypted).
- **The object store.** `core/objects.ts` holds one array of `SystemObject`s (documents, cards, tasks, projects, files, memory) and is the single source of truth for user data. Every object carries a monotonic `rev` (the version token for stale-edit detection) and supports recoverable trash. `storage.get()` returns one stable reference per key — even for absent/invalid keys — so `useSyncExternalStore` snapshots never churn.
- **Reactive state.** `useStoredValue(key, fallback)` binds React state to a storage key; `useObjects()` / `useObjectsOfType()` bind to the object store. Apps persist through these hooks and never touch `localStorage` directly.
- **The spatial shell.** `Workspace` projects the active layout's dense unit coordinates (`core/desktop.ts`, 96×54 units) into a fixed, non-scrolling surface. Neighboring tiles share borders; drags and resizes snap to edges, centers, equal gaps, and equal sizes with contextual guides (`core/snap.ts`). Focus is a projection (`core/focusLayout.ts`): the focused tile's rect grows and the rest compress into a band — the same elements transition between rects, so every mode change animates with spatial continuity. Persistent edge widgets (`state.widgets`) render across all views and reserve their band of the surface.
- **The AI trust layer.** `aiContext.ts` builds the `AIContextPacket` the assistant may read (scoped by the workspace + effective permissions). Anything that would change data becomes an `ActionProposal` in `broker.ts`, which the user approves or declines (or which a user-enabled Trusted Action runs automatically) — every transition logged to the audit spine. Security Core's gate runs at propose, approve, *and* execute against a typed **Action Definition registry** (`actionRegistry.ts`): each action id binds to its owner Core, permitted apps, effect kind, object/target types, allowed payload fields, and executor — so an unknown action, a spoofed app, a mismatched effect, or a stray field denies structurally, not just when a label happens to be in the wrong tier. Every AI write (Editor, Files, Web, Monitor, Secrets) routes through AI Core first. Moving an app's write capabilities out of the writable tiers in the AI Control Center genuinely blocks its AI writes.
- **Appearance.** `AppearanceProvider` holds theme/accent/density/system-name, applies it by flipping `data-*` attributes on `<html>` and copying one accent pair into live CSS variables, and persists it. All theming is CSS custom properties in `styles/tokens.css`, so a theme or density change is one attribute flip.

### Design language

Monochrome-first, one accent color, straight lines (zero border-radius), hairline borders, strong typography, dark + light. A deliberate signature: **monospace is the "system voice"** — used for every machine fact (the clock, capability tiers, audit timestamps, IDs) so data reads differently from prose. Touching tiles merge into one shared hairline; empty space exists only where the user made it. Responsive by compression: the fixed surface scales with the viewport and tiles step down through presentation modes (full → compact → mini → icon) before the phone-width stacked layout takes over. Respects `prefers-reduced-motion` and `prefers-color-scheme`.

---

## The AI permission model

This is the heart of Locus. Each app publishes a **capability manifest** sorting the things an AI could do into five escalating tiers:

| Tier | Meaning |
|---|---|
| **Readable** | The AI can see this. |
| **Suggestible** | The AI can propose a change. Nothing happens until you act. |
| **Writable with approval** | The AI can make the change — but only after you approve it. |
| **Trusted** | The AI can do this automatically, without asking. |
| **Forbidden** | The AI can never do this, under any circumstance. |

Apps only *declare* defaults. The **AI Control Center** renders every app's manifest and lets **you** move any individual capability to a different tier. Your choice is stored as an *override* on top of the declaration (`core/permissions.ts` merges declared + overrides into the *effective* permissions a future AI runtime would consult), and every change is written to the audit log. By design, no app can change its own permissions, and no app starts with a **write, delete, or external** capability in **Trusted** — a handful of apps declare only low-risk *local* capabilities as Trusted defaults (rendering a preview, sorting visible items, ranking local results, running an index pass). A Trusted Action auto-runs a capability only while that capability actually sits in the Trusted tier, so escalating anything consequential is a deliberate, logged, user action.

No real model is wired up; provider selection (None / on-device / cloud) persists but is inert. What's real and complete is the *governance model* the AI would have to obey — and the broker that enforces it.

### The AI Broker

Every change the AI proposes becomes an **`ActionProposal`** (`core/broker.ts`): recorded, shown in the **AI Assistant → Approvals** queue, and executed only after you approve it — *or* automatically if you've enabled a matching **Trusted Action** (each with a named scope, trigger, data-touched note, and undo note). The **Credential Broker** exposes external accounts as *scoped capabilities* (e.g. "Read events") rather than raw secrets. Every transition — propose, approve, deny, execute, trusted-run, credential grant — is written to the audit log.

---

## Roadmap status

The implementation roadmap's nine phases, and where each stands in this build:

| Phase | Status |
|---|---|
| 0. Repo audit & decisions | ✅ React/TS/Vite; this document is the architecture note |
| 1. Spatial shell MVP | ✅ Fixed spatial surface, dense-unit placement + snapping/guides, in-place Focus, edge widgets, workspaces, responsive compression |
| 2. Modular app registry | ✅ Manifest schema with category/status/icon/anchor eligibility + command registration |
| 3. Local persistence | ✅ Appearance, workspace layouts, recent apps, audit, objects, sources — all survive reload |
| 4. Core app stubs | ✅ Nineteen real modules wired through the registry |
| 5. AI context surfaces | ✅ AI Assistant anchor + context inspector rendering the `AIContextPacket` |
| 6. Real local objects | ✅ Shared `SystemObject` store; Writer/Cards/Tasks/Projects/Files/Search all read & write it |
| 7. Indexing & connected scopes | ✅ Indexer with metadata summaries, source scopes, exclusions, and a live index-status UI |
| 8. Brokered AI actions | ✅ AI Broker approval lifecycle, Trusted Actions, Credential Broker, full audit trail |
| 9. Platform expansion | ◐ Scaffolded: platform targets + a model-routing table; deep native/server work stays deferred by design |

## What's functional vs. placeholder

**Functional (real, persists locally):**

- **The spatial shell** — a fixed non-scrolling surface of placed tiles in dense unit coordinates; near-freeform drag with snapping and alignment guides; resize from **any side or corner**, with shared borders moving for both tiles and blocking tiles stopping the border; every tile sizeable down to an icon; placement that **always succeeds** (shrink → fill a gap → repack to make room — no floating windows, ever); **Shuffle** (rearrange + resize all tiles so there are no gaps); Focus that transforms the layout in place (the rest of your tiles compress around the focused one, still live and clickable); Freeform mode whose controls live in the header (Save as Workspace / Save as Dashboard / discard / to Scratchpad); saved Workspaces; the Scratchpad; command palette (Cmd/Ctrl-K); stacked tiles on phones.
- **The header** — one or more customizable edge segments made of header items you can add, remove, and reorder; segments can occupy any edge, even several edges at once. The logo (→ Dashboard), the Dashboard ↔ Focus switcher (Focus reopens the last focused app, or is just empty space), Freeform, Apps, and Settings always survive somewhere, so every surface stays reachable.
- **The Core Services layer** (developed against the **Core API Focus List**) — Time Core (alarms, timers, events, reminders, reschedule, a timed-trigger scheduler that fires through Notification Core, and `describeUpcoming` for the AI), Monitor Core (watches over storage, task deadlines, object changes, **stale items**, and contact cadence, evaluated on a real loop, with snooze and history), Cardspoke Core (**modeled on the CardSpoke app's reusable core**: `[[wiki-links]]` with backlinks, related-by-tags, reversible note↔task↔document conversions, outline→tasks, and saved filters over the shared store), Secrets Core (secret:// references, brokered use, existence checks for AI, reveal-on-explicit-action, and a leak detector that redacts search/AI output), Editor Core (undo/redo stacks, transformations, **line-diff previews**, structured AI edit transactions that land in the approval queue, real export), People Core (interaction channels + per-contact cadence health, the Pal-Plant model), Web Core (shortcuts + permissioned page-context requests + page watches), Files Core (real local bytes behind the byte-store seam, import/download, source grants + brokered access whose grants release real bytes), Search/Index Core (query grammar `type:/tag:/before:/after:`, recency-aware ranking, relationship discovery, redacted context snippets), Notification Core (priority + snooze + **quiet hours** + grouping), Security Core (risk classification + **sandbox policy** + capability-manifest evaluation), AI Core (the routing table + keyword **model-routing rules**, local-by-default), Media Core (content-based kind detection over real bytes + Blob-URL playback + metadata over the file store), and **Dev Core** (code artifacts with capability manifests, diffs, five-check validation, **real sandboxed execution in an isolated iframe** with log capture, install/uninstall, versioned rollback, provenance, and a **devwidget tile runtime** — installed widget artifacts run on the desktop in a sandboxed iframe whose only OS channel is a manifest-gated read-only RPC). The **System Cores** app renders the whole registry — focus, AI path, boundary, live counts.
- **Core-backed apps** — Time (today/alarms/timers/stopwatch/upcoming), Monitor (watches, suggestions, trigger history), Vault (masked secrets, brokered use, leak detector), Contacts (people, groups, birthdays → Time Core reminders, cadence → Monitor Core watch), Browser (web app/PWA shortcuts), and cross-core workflows in Tasks (due dates + ⏰ reminders via Time Core) and Writer (export + “Propose AI tidy” via Editor Core transactions).
- **Shared objects** — Writer (multi-document Markdown), Cards (editable, with links & backlinks), Tasks (priority, project links), Projects (real linking of any object), Files (metadata entries, plus real byte-backed files via Import), and Search (real full-text across every object) all read and write one store.
- **AI Assistant** — answers reads and turns writes into proposals; rule-based by default, dispatching to your configured model endpoint when the runtime is enabled (falling back to rules with an honest explanation otherwise); a context inspector; an approval queue; editable memory.
- **AI Control Center** — provider selection, the Model runtime panel (endpoint/model/enable, brokered API-key arming, remote-endpoint acknowledgment, connection test), per-app effective-permission editing, Trusted Actions, and the Credential Broker.
- **Connected Sources** — readable/indexable scopes, exclusions, on-demand indexing, and index status.
- **Settings / Audit Log / Platform** — appearance + storage; a real append-only event log with filters; platform targets + model routing.

**Placeholder (clearly labeled):** Anywhere an app shows a **`PLANNED`** callout, that's a stub boundary. Files can now hold real local bytes (OPFS/IndexedDB via the byte-store seam — import, download, previews, playback); the native File System Access picker and folder mounts are still future. The assistant is rule-based unless you explicitly configure and enable a model endpoint in AI Control (the governance path is identical either way), and connected sources beyond the local store are declared surfaces. This honesty is intentional: the OS tells you plainly what's foundation and what's future.

---

## How to add a new app module

Adding an app is a two-step wiring job — the registry does the rest (launcher, home, search, command palette, and AI Control Center all pick it up automatically).

1. **Create the app.** Add `src/apps/<id>/<Name>.tsx` with a default-exported React component (and a `<name>.css` if it needs styles). Use `useStoredValue` from `@/core/hooks` to persist anything, and the shared primitives in `@/components/ui` (`Section`, `FutureNote`, etc.) so it matches the system.

2. **Register it.** Add the app's id to the `AppId` union in `src/types/app.ts`, then append one entry to the `APPS` array in `src/core/appRegistry.ts`:

```ts
{
  id: "my-app",
  name: "My App",
  description: "One short line for the launcher.",
  icon: "◆",                       // single glyph, drawn in a mono tile
  category: "workspace",           // or "system"
  status: "stub",                  // stub | beta | stable — drives a badge
  component: MyApp,                // imported at the top of the file
  keywords: ["searchable", "terms"],
  anchor: { eligible: true, defaultSpan: { col: 2, row: 1 }, preview: MyAppPreview }, // optional
  permissions: {
    localData: ["what this app stores locally"],
    device: [],
    network: [],
    ai: {
      readable: ["What the AI may see"],
      suggestible: ["What the AI may propose"],
      writableWithApproval: ["What the AI may do once you approve"],
      trusted: [],                 // keep empty by default
      forbidden: ["What the AI must never do"],
    },
  },
}
```

That's the entire integration. The app now appears in the launcher, command palette, and Search; if it stores `SystemObject`s it's indexable and cross-linkable; if `anchor.eligible` is set it can be placed on the spatial desktop; and its AI capabilities show up (and become user-editable) in the AI Control Center.

---

## Tech notes

- **Stack:** React 18 + TypeScript + Vite. Runtime dependencies are only `react` and `react-dom`; everything else (router-free navigation, state, storage, the PWA layer) is hand-rolled to keep the system small and transparent.
- **Tests:** Vitest + jsdom for the Core Services layer (`src/core/cores/*.test.ts`, plus `storage.test.ts`) against real `src/core/storage.ts` persistence, and Playwright + real Chromium (`e2e/`) for what jsdom can't run — the Dev sandbox iframe/Worker, the devwidget iframe runtime (RPC delivery + CSP network denial), multi-tab storage races, and the offline service worker. The shell/app layer otherwise relies on typecheck, build, and manual verification.
- **No router** — "where you are" is a little shell state (the active workspace / launcher / one focused app), which keeps back-button and Escape behavior explicit.
- **PWA is hand-written** — `public/manifest.webmanifest` + a small, readable `public/sw.js` (no Workbox), so the offline story stays legible. The service worker registers only in production builds.
- **Accessibility:** semantic HTML, visible focus states, 44px minimum tap targets, keyboard navigation throughout, labels on controls, and no reliance on color alone (badges and text carry meaning too).

## Development governance

This repo uses Spec-Driven Docs for AI-agent and contributor guidance. Start with `AGENTS.md`, then read `development-docs/coreIdentity.md`; consult `development-docs/developmentManifesto.md`, `development-docs/architecture.md`, and `development-docs/productRoadmap.md` when the task affects development standards, architecture, or product direction. Repo-local skills live under `skills/` (governance workflow, platform portability, Linux translation, design language, validation). The declared long-term direction — Locus OS as the shell of a Linux-based OS, developed with `jxburros/locus-linux` — is planned in `development-docs/linuxIntegrationPlan.md`. Meaningful work should append to `CHANGELOG.md`.

---

*Version 0.6.0 — the three formerly-planned future versions delivered: real local file bytes (OPFS/IndexedDB byte store behind Files Core, media detection + playback over real content), the Dev authoring app + sandboxed devwidget tile runtime (manifest-gated read-only RPC), and an explicit-opt-in model runtime (endpoint you configure, brokered keys, audited dispatch, rule-based fallback).*

---

## Project Stewardship

This project is developed by **Jeffrey** through **JX Holdings, LLC**. GitHub: [`jxburros`](https://github.com/jxburros).
