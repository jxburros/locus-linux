# Locus OS - Core Identity

> Read this file first before making meaningful changes to Locus OS.
>
> This document defines what Locus OS is, what it protects, and what it must not become. It is not a backlog.

## Project Identity

Locus OS is a local-first, AI-aware personal operating environment that runs in the browser and installs as a PWA.

It exists to help an individual manage their personal knowledge, tasks, files, contacts, schedules, sources, and AI-assisted actions inside one spatial operating surface without turning the user's data into app silos or AI-owned state.

Locus OS is not a clone of Windows, macOS, Android, Notion, or a conventional dashboard. It is a browser-native OS shell organized around a spatial workspace, shared Core services, and explicit user-governed AI action boundaries.

## Identity Statement

> "Apps are surfaces; Cores own shared truth; the user owns the system."

## Core Purpose

The purpose of Locus OS is to make personal computing feel like one coherent local environment instead of a collection of disconnected apps.

It should help users:

- Place work spatially and return to it without losing context.
- Create documents, cards, tasks, projects, files, contacts, reminders, watches, and sources that share one object model.
- Search and link across their own local data.
- Let AI inspect and propose actions only through explicit, auditable boundaries.
- Install and use the environment as an offline-capable PWA.

## Central Philosophy

Locus OS is built around the belief that a personal OS should be local-first, inspectable, and governed by user-approved actions rather than hidden automation.

This means:

- User data should remain local by default.
- Shared system capabilities should live in Cores, not be duplicated privately by every app.
- AI may assist, propose, route, and summarize, but it must not silently mutate user data.
- The system should show which parts are real, which are scaffolded, and which are future boundaries.

When tradeoffs arise, favor local control, explicit permission, auditability, and architectural honesty over convenience, hidden magic, or speculative integration.

## Identity Pillars

### Local First

The browser runtime is not a thin cloud client. Current state persistence is localStorage with an IndexedDB recovery mirror through `src/core/storage.ts`; file bytes use OPFS/IndexedDB through `src/core/byteStore.ts` and Files Core. The architecture keeps backend changes behind these seams.

Local-first does not mean "never integrate." It means external services, cloud models, sync, native files, and provider APIs must be explicit, permissioned, and documented.

### One Object, Many Apps

Documents, cards, tasks, projects, files, and memory are all `SystemObject`s in one shared store. Apps are lenses over this store, and Cores should become the stable contracts underneath those lenses.

This protects search, linking, projects, AI context, and generated tools from fragmenting into app-specific private state.

### Actions Are The Security Boundary

Reading and indexing may be broad within a connected local scope, but writing is governed. AI-capable actions are represented through capability manifests, effective permission tiers, proposal queues, trusted actions, and audit events.

The long-term direction is runtime enforcement, not just display-level permission labels.

### Spatial Continuity

The workspace is a fixed, non-scrolling spatial surface using dense unit coordinates, snapping, shared borders, presentation modes, edge header segments, and in-place Focus. Navigation should preserve place and continuity instead of sending the user through unrelated pages.

## Target Users and Use Cases

Primary users are individuals who want a personal operating environment for local knowledge, planning, and AI-assisted work.

They use Locus OS to:

- Maintain notes, documents, tasks, projects, contacts, and local file metadata.
- Build a personal dashboard and workspace out of live tiles.
- Use AI as an assistant that proposes changes rather than silently taking over.
- Inspect system Cores, permissions, sources, and audit history.

Secondary users include developers and AI agents extending the system. They should not distort the product into a generic app framework at the expense of the user's local-first personal OS.

## Product and Design Ethos

The interface should feel like a deliberate OS surface: precise, dense, spatial, inspectable, and calm.

Preserve these design traits:

- Monochrome-first visual language with one accent color.
- Straight lines, hairline borders, strong typography, and zero-radius geometry.
- Monospace as the "system voice" for machine facts, timestamps, ids, and capability tiers.
- Visible focus states, keyboard navigation, and tap targets suitable for PWA use.
- Responsive compression rather than a separate unrelated mobile experience.

Avoid:

- Decorative dashboards that hide system state.
- Floating window piles.
- Rounded card-heavy marketing layouts.
- Visual novelty that weakens spatial clarity.

## AI Role and Boundaries

AI is assistive and governed in Locus OS. The default assistant is local and rule-based. The optional `src/core/modelRuntime.ts` dispatches only to an explicitly configured and enabled endpoint, with additional acknowledgment for remote data transfer; local behavior remains the fallback.

AI may:

- Assemble allowed local context.
- Answer from visible local data.
- Route intent toward the appropriate Core.
- Draft proposals for edits, objects, reminders, files, or generated artifacts.
- Help explain system state and permissions.

AI must not:

- Mutate user data without an approved proposal or a user-enabled trusted action.
- Read raw secret values.
- Send local data to cloud providers without explicit configuration and approval.
- Bypass app capability manifests, effective permission tiers, Security Core, Broker, or Audit Log.
- Treat generated content, summaries, or guesses as verified facts.

When AI features are unavailable, the system should remain useful as a local personal OS. AI is a capability layer, not the foundation of the user experience.

## Data, Privacy, and Ownership Stance

User data belongs to the user and should remain on the user's device by default.

The project should:

- Store user objects locally unless the user explicitly enables a connected source, sync, or provider.
- Keep secrets behind references and brokered use rather than raw exposure.
- Redact sensitive values from search snippets, AI context, proposals, generated artifacts, and logs where possible.
- Make external reads and writes explicit and auditable.

The project should not:

- Upload user data by default.
- Hide AI or system mutations.
- Store raw secrets as normal objects.
- Add telemetry or external provider calls without a deliberate project-level decision.

## What This Project Is

Locus OS is:

- A browser-native personal operating environment.
- A PWA shell with a spatial workspace.
- A local-first shared object system.
- A Core-services architecture for reusable capabilities.
- A governed AI action environment.
- A place to prototype safe generated widgets and apps through Dev Core.

## What This Project Is Not

Locus OS is not:

- A conventional desktop clone.
- A cloud-first SaaS dashboard.
- A generic web app starter.
- A fully autonomous AI agent.
- A hidden browser/scraper for AI.
- A place for apps to maintain private duplicate truths that should belong to Cores.
- A system where convenience justifies silent deletion, secret leakage, or unapproved writes.

## Hard Constraints / Never List

- No silent AI writes: AI-originated writes must flow through proposals, approvals, trusted actions, and audit.
- No raw secret exposure to AI: AI may know that a secret reference exists, not the secret value.
- No default cloud dependency: the core experience must remain usable without external provider setup.
- No hidden external dispatch: network, provider, sync, source, and browser actions must be explicit and permissioned.
- No app-private duplication of Core-owned truth: if a Core owns behavior or state, app surfaces should consume the Core API rather than bypass it.
- No destructive data loss as a normal UI path: deletion-like operations should use trash, recovery, confirmation, or an explicitly documented exception.
- No speculative architecture in architecture docs: document what exists and label future work as roadmap or open question.

These constraints should change only through an explicit project-level decision.

## Domain Model / Core Concepts

### Spatial Surface

The desktop is a fixed unit-grid workspace with placed tiles, snapping, shared borders, presentation modes, edge header segments, and Focus as an in-place projection.

### SystemObject

The shared object model for documents, cards, tasks, projects, files, and memory. Apps should act as lenses over this store.

### Core

A reusable system contract that owns shared behavior, state, or policy used by multiple apps. Locus currently defines fourteen Cores: Time, Cardspoke, Editor, Files, Search/Index, People, Monitor, Web, AI, Secrets, Security, Notification, Media, and Dev.

### Capability Manifest

Each app declares AI-related capabilities by tier: readable, suggestible, writable with approval, trusted, and forbidden.

### Action Proposal

An AI or system-suggested write action that must be approved or explicitly trusted before execution.

## Success Criteria

The project is succeeding when:

- The spatial shell remains coherent and usable.
- Apps increasingly consume Core APIs instead of bypassing them.
- Local data, search, linking, audit, and permissions work together across apps.
- AI behavior remains visible, permissioned, and auditable.
- The README and development docs honestly distinguish working behavior from scaffolded/future behavior.

The project is drifting when:

- Apps create private stores or policy paths that bypass Cores.
- AI can mutate data outside the brokered proposal path.
- The registry claims events, consumers, or enforcement that code does not implement.
- Local-first behavior is weakened by hidden cloud assumptions.
- Documentation becomes aspirational instead of accurate.

## Decision Filter for Future Changes

Before adding a feature, dependency, app, Core, or AI path, ask:

1. Does this reinforce local-first personal control?
2. Does the behavior belong in an existing Core before an app surface?
3. Does it preserve the action-as-security-boundary model?
4. Does it keep the spatial shell coherent?
5. Does it make the architecture more honest and inspectable?
6. Does it remain useful if AI or cloud providers are unavailable?
7. Can the user understand, approve, audit, and undo or recover from the change?

## Maintainer Confirmation Needed

The following identity items are inferred from repository evidence and should be confirmed by the maintainer:

- Whether "Locus" remains a placeholder name or the repo should standardize on "Locus OS" in governance docs.
- Which target user should dominate product decisions: the maintainer as primary user, broader personal-OS users, or developers extending Locus.
- Whether "no telemetry by default" should be elevated to an explicit permanent hard constraint.
- Whether external sync/cloud model support is planned, rejected, or deliberately deferred.

## Related Documents

- `development-docs/developmentManifesto.md` defines development standards and Definition of Done.
- `development-docs/architecture.md` defines current structure and architectural invariants.
- `development-docs/productRoadmap.md` defines version-level direction and rejected/deferred scope.
- `AGENTS.md` defines agent operating rules.
- `CLAUDE.md` and `.github/copilot-instructions.md` are tool-specific overlays.
- `CHANGELOG.md` records meaningful changes.
- `README.md` is the public project overview.
