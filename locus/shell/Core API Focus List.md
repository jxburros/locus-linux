# Core API Focus List

This is a working list for the decided Locus Cores. A Core should exist when a capability is reused by many apps, owns shared state or behavior, or needs a governed AI interaction path.

Apps are user-facing surfaces. Cores are the shared contracts underneath them. The AI should build with Cores instead of bypassing them.

## Core Selection Rule

A capability should become a Core when several of these are true:

- Multiple common apps need it.
- It owns a source of truth that should not be duplicated.
- AI needs to read, reason over, or act through it directly.
- It needs permission checks, audit events, approval, undo, redaction, or sandboxing.
- Generated apps, widgets, or anchors would be safer and easier if the capability were already available.

## Time Core

Focus: OS-wide time, dates, schedules, reminders, alarms, timers, recurrence, and time-based triggers.

Time Core should give every app the same way to create reminders, attach due dates, schedule recurring events, and fire time-based actions. It should make "when" a shared system concept instead of letting Tasks, Calendar, Monitor, and AI each invent their own schedule logic.

AI should use Time Core to propose reminders, schedule follow-ups, reason about deadlines, create time-based watches, and explain upcoming commitments.

Do not let Time Core become a full productivity app. Calendar, Tasks, and Dashboard can be surfaces over it.

## Cardspoke Core

Focus: shared structured user information: cards, notes, tasks, lightweight documents, links, backlinks, tags, and conversions between information shapes.

Cardspoke Core should make user-created knowledge portable across apps. A note can become a task, a card can link to a project, and a document section can become a reusable object without each app maintaining a private data silo.

AI should use Cardspoke Core to create, link, summarize, transform, and retrieve structured user objects.

Do not make Cardspoke responsible for editing mechanics, file bytes, or app-specific presentation.

## Editor Core

Focus: shared editing behavior for text and editable artifacts: selection, undo/redo, transformations, suggestions, export, and AI edit transactions.

Editor Core should define how edits happen, how they can be previewed, how they can be undone, and how AI-generated changes become inspectable transactions before touching user content.

AI should use Editor Core for rewrites, text cleanup, insertions, document restructuring, diff previews, and proposal-based edits.

Do not make Editor Core own the content model. Cardspoke owns structured objects; Files owns file references; Dev Core owns runnable code artifacts.

## Files Core

Focus: files, folders, file references, metadata, previews, recents, trash/restore, source grants, and file change events.

Files Core should be the common file authority, even while the browser app phase only stores metadata. Later it can map to native filesystems, cloud mounts, external drives, and app sandboxes without changing every app.

AI should use Files Core to reason about granted file scopes, propose file organization, summarize indexed file metadata, and request brokered access to files.

Do not define Files Core as "localStorage rows." The concept is user-granted file/source capability; the browser implementation is only the first version.

## Search / Index Core

Focus: OS-wide search, indexing, source metadata, ranking, recents, relationship discovery, and redaction-aware retrieval.

Search / Index Core should make all user-authorized context findable through one path: apps, objects, files, contacts, settings, source metadata, and eventually semantic relationships.

AI should use Search / Index Core to retrieve relevant context, build context packets, cite local sources, find relationships, and respect source exclusions.

Do not let each app build its own private index unless it reports into the shared index.

## People Core

Focus: contacts, identities, groups, relationships, birthdays, cadence, interaction history, and people-linked notes or tasks.

People Core should make people a system-level concept. Apps should refer to the same contact identities, relationship metadata, and follow-up cadence instead of copying names into isolated fields.

AI should use People Core to suggest follow-ups, draft reminders, link notes to people, reason about relationship context, and avoid exposing contact details without approval.

Do not make People Core a messaging app. Messaging, email, and social surfaces should use it.

## Monitor Core

Focus: watches, conditions, triggers, health checks, status changes, stale items, overdue work, recurring evaluations, and alert history.

Monitor Core should be the personal observability layer. It watches user-chosen conditions across other Cores and tells Notification Core when attention is needed.

AI should use Monitor Core to propose watches, summarize changes, detect stale workflows, and help users turn concerns into observable conditions.

Do not make Monitor Core decide all product behavior. It observes and triggers; other Cores own the domain state.

## Web Core

Focus: web apps, PWAs, URLs, embedded web surfaces, web permissions, browsing/session behavior, downloads, and page metadata.

Web Core should make web capability a shared OS service rather than a single Browser app. A dashboard widget, monitor watch, app shortcut, or generated tool should all use one governed web layer.

AI should use Web Core to propose web app shortcuts, request permissioned page context, create watches over web resources, and open external URLs only through approved user action.

Do not let Web Core become an ungoverned scraper or hidden browser for AI.

## AI Core

Focus: context assembly, model routing, assistant state, action planning, proposal creation, Core routing rules, and AI-visible system contracts.

AI Core should be the OS-level intelligence layer. It decides what context an assistant can see, which model/provider should handle a task, and which Core should execute or propose each action.

AI should use AI Core to understand the environment, but AI Core should route actions through other Cores: edits through Editor, code through Dev, reminders through Time, files through Files, secrets through Secrets, and notifications through Notification.

Do not let AI Core directly mutate everything. It should coordinate, propose, and route.

## Secrets Core

Focus: secrets, credentials, tokens, passkeys, secret references, brokered secret use, redaction, reveal events, and secret-use audit.

Secrets Core should let the OS use sensitive values without exposing raw secrets to apps or AI. Apps and generated tools should receive scoped capabilities, not raw keys.

AI should use Secrets Core only by requesting brokered actions, checking whether a secret reference exists, or proposing credential setup. It should never read raw secret values.

Do not store secrets as ordinary objects or file metadata.

## Security Core

Focus: permissions, trust levels, risk classification, sandbox policy, approval rules, app install safety, trusted actions, and capability enforcement.

Security Core should be the policy authority for what apps, Cores, and AI may do. It should classify actions by risk, enforce permission tiers, and make dangerous capability escalation explicit.

AI should use Security Core to understand whether an action is readable, suggestible, writable with approval, trusted, or forbidden, and to explain why a request needs approval.

Do not bury security rules inside individual apps. Apps can declare capabilities; Security Core decides effective policy.

## Notification Core

Focus: alerts, reminders, status messages, user attention requests, notification history, priority, snooze, grouping, and delivery surfaces.

Notification Core should deliver attention requests consistently across the OS. Time, Monitor, AI Broker, Tasks, Files, and Dev should all use it instead of inventing their own alert behavior.

AI should use Notification Core to propose or send approved notifications, explain why something needs attention, and respect quiet hours or notification policy.

Do not make Notification Core decide what matters. Other Cores decide that; Notification Core delivers it.

## Media Core

Focus: images, audio, video, playback, recording, media metadata, thumbnails, waveform/timeline primitives, and media permissions.

Media Core should make media handling reusable across Files, Viewer, Screen, Music, future creative apps, and generated widgets.

AI should use Media Core to inspect allowed media metadata, generate previews, propose edits, transcribe or summarize media when permitted, and route media creation/editing through governed operations.

Do not make Media Core a single media app. Photos, Music, Video, Viewer, and editors should be surfaces over it.

## Dev Core

Focus: code artifacts, generated apps, widgets, anchors, manifests, diffs, previews, sandboxed execution, validation, packaging, dependency policy, provenance, and rollback.

Dev Core should be the system contract for software creation inside Locus. It should let AI generate and modify code safely by using a governed pipeline: create a proposal, show the diff, declare permissions, run in a sandbox, validate, preview, and only then install or update an app/widget/anchor.

AI should use Dev Core to scaffold apps, generate widgets, create anchors, edit code, explain changes, run checks, capture logs, and package artifacts into the app registry.

Dev Core should own:

- Code objects: app modules, widgets, anchors, snippets, manifests, templates, and generated files.
- Code display: syntax highlighting, diffs, file trees, dependency views, and generated-change summaries.
- Code generation: scaffolds, patches, refactors, permission manifests, and app registry entries.
- Execution: sandboxed runs, previews, logs, stdout/stderr capture, stop/restart controls, and resource limits.
- Validation: typecheck, lint, tests, build checks, accessibility checks, manifest checks, and security checks.
- Packaging: promotion from generated artifact to installed Locus app/widget/anchor.
- Provenance: prompt/context used, model/provider, approvals, diffs, versions, rollback points, and audit trail.
- Policy: dependency allowlists, network access rules, file access rules, secret access rules, and install permissions.

Do not let Dev Core become just a code editor. Editor Core can edit text; Dev Core understands runnable software and governs generated behavior.

## Cross-Core Principle

The best Cores should be small contracts that compose well. For example, when AI generates a deadline widget:

1. Dev Core creates and validates the widget.
2. Security Core checks requested capabilities.
3. Cardspoke Core supplies task objects.
4. Time Core supplies due dates and recurrence.
5. Search / Index Core makes the widget discoverable.
6. Notification Core delivers alerts.
7. AI Core routes the proposal.
8. Audit records the chain of custody.

The point is not to make every feature heavy. The point is to prevent duplicated truths and give AI a safe, stable way to build.
