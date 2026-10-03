# Local reference guide

All links below resolve within this repository. Start with
[identity](../shell/development-docs/coreIdentity.md),
[architecture](../shell/development-docs/architecture.md), and
[the platform plan](integration-plan.md). The shell package root is `locus/shell/`;
its `src/` paths below are relative to that package.

## Product, UX, and contribution rules

| Need | Local source |
|---|---|
| User ownership, privacy, safety | [Core identity](../shell/development-docs/coreIdentity.md) |
| Development standards and completion | [Manifesto](../shell/development-docs/developmentManifesto.md), [shell instructions](../shell/AGENTS.md) |
| Current architecture | [Architecture](../shell/development-docs/architecture.md) |
| Delivered and deferred scope | [Product roadmap](../shell/development-docs/productRoadmap.md) |
| Complete spatial/visual specification | [Design](../shell/development-docs/design.md), [design skill](../shell/skills/locus-shell-design-language/SKILL.md), [CSS tokens](../shell/src/styles/tokens.css) |
| App and Core intent | [Core API focus list](../shell/Core%20API%20Focus%20List.md), [standard apps](../shell/Locus_OS_Standard_Apps.md) |
| Native translation and seams | [Translation skill](../shell/skills/locus-linux-translation/SKILL.md), [portability skill](../shell/skills/locus-platform-portability/SKILL.md) |
| Validation | [Validation skill](../shell/skills/locus-validation-loop/SKILL.md), [shell README](../shell/README.md) |
| Historical rationale | [Shell changelog](../shell/CHANGELOG.md), [baseline audit](../shell/locus-os-core-system-audit-2026-07-10.md), [stabilization report](../shell/development-docs/coreSystemStatus-2026-07-11-completion.md) |

Historical analysis is not a substitute for current code. Older analysis filenames
that were absent from the imported commit are not required reading. The full
available reports and project history are preserved locally.

## Executable contracts

| Boundary | Implementation / types | Existing verification |
|---|---|---|
| Shared objects | [objects.ts](../shell/src/core/objects.ts), [object types](../shell/src/types/objects.ts) | Broker/storage/Core suites exercise object lifecycle; no dedicated objects suite |
| Actions and authorization | [actionRegistry.ts](../shell/src/core/actionRegistry.ts), [broker.ts](../shell/src/core/broker.ts), [permissions.ts](../shell/src/core/permissions.ts) | [broker tests](../shell/src/core/broker.test.ts), Security/AI/registry suites |
| State persistence | [storage.ts](../shell/src/core/storage.ts) | [storage tests](../shell/src/core/storage.test.ts), [multi-tab e2e](../shell/e2e/multitab.spec.ts) |
| Byte persistence | [byteStore.ts](../shell/src/core/byteStore.ts) | [byteStore tests](../shell/src/core/byteStore.test.ts), Files/Media suites |
| App capabilities and registry | [appRegistry.ts](../shell/src/core/appRegistry.ts), [app types](../shell/src/types/app.ts) | [Core registry tests](../shell/src/core/cores/registry.test.ts), broker suite |
| AI context and dispatch | [aiContext.ts](../shell/src/core/aiContext.ts), [modelRuntime.ts](../shell/src/core/modelRuntime.ts) | [model runtime tests](../shell/src/core/modelRuntime.test.ts), [assistant tests](../shell/src/core/assistant.test.ts) |
| Events and audit | [events.ts](../shell/src/core/events.ts), [audit.ts](../shell/src/core/audit.ts) | Core/broker tests; no standalone native log implementation |
| Spatial shell | [desktop.ts](../shell/src/core/desktop.ts), [Workspace.tsx](../shell/src/components/desktop/Workspace.tsx), [tile types](../shell/src/types/desktop.ts) | Unit/Core checks do not prove all visual layouts; manual shell smoke required for UI edits |
| Offline PWA | [worker](../shell/public/sw.js), [manifest](../shell/public/manifest.webmanifest), [Vite build](../shell/vite.config.ts) | [PWA e2e](../shell/e2e/pwa.spec.ts) against production preview |
| Generated widget runtime | [DevWidgetTile.tsx](../shell/src/components/tiles/DevWidgetTile.tsx) | [sandbox e2e](../shell/e2e/sandbox.spec.ts), [widget e2e](../shell/e2e/devwidget.spec.ts) |

Native IPC schemas are not yet defined. Port current semantics, including negative
paths, rather than assuming TypeScript signatures can all be serialized unchanged.
State export excludes bytes; media Blob URLs are browser-local; subscription
callbacks and raw byte buffers require a deliberate transport at M3.

## Fourteen Core reference implementations

Every row links to the implementation and its existing co-located regression suite.
[Registry](../shell/src/core/cores/registry.ts) is an inspectable claim, and its
[tests](../shell/src/core/cores/registry.test.ts) check structural consistency.

| Core | Owned behavior | Local code | Local tests |
|---|---|---|---|
| Time | alarms, events, recurrence, scheduler/triggers | [time.ts](../shell/src/core/cores/time.ts) | [tests](../shell/src/core/cores/time.test.ts) |
| Cardspoke | links/backlinks, conversions, tasks/filters | [cardspoke.ts](../shell/src/core/cores/cardspoke.ts) | [tests](../shell/src/core/cores/cardspoke.test.ts) |
| Editor | undo/redo, transforms, diffs, AI edit transactions | [editor.ts](../shell/src/core/cores/editor.ts) | [tests](../shell/src/core/cores/editor.test.ts) |
| Files | metadata/bytes, grants, import, trash/recovery | [files.ts](../shell/src/core/cores/files.ts) | [tests](../shell/src/core/cores/files.test.ts) |
| Search/Index | query grammar, ranking, exclusions/redacted retrieval | [searchIndex.ts](../shell/src/core/cores/searchIndex.ts) | [tests](../shell/src/core/cores/searchIndex.test.ts) |
| People | contacts, groups, birthdays/cadence | [people.ts](../shell/src/core/cores/people.ts) | [tests](../shell/src/core/cores/people.test.ts) |
| Monitor | watches, checks, snooze, alert history | [monitor.ts](../shell/src/core/cores/monitor.ts) | [tests](../shell/src/core/cores/monitor.test.ts) |
| Web | shortcuts, explicit external open, page-context seams | [web.ts](../shell/src/core/cores/web.ts) | [tests](../shell/src/core/cores/web.test.ts) |
| AI | routes, context, governed proposals | [ai.ts](../shell/src/core/cores/ai.ts) | [tests](../shell/src/core/cores/ai.test.ts) |
| Secrets | encrypted vault, references, brokered use, redaction | [secrets.ts](../shell/src/core/cores/secrets.ts) | [tests](../shell/src/core/cores/secrets.test.ts) |
| Security | typed action gates, permissions, risk | [security.ts](../shell/src/core/cores/security.ts) | [tests](../shell/src/core/cores/security.test.ts) |
| Notification | delivery policy, quiet hours, snooze/history | [notification.ts](../shell/src/core/cores/notification.ts) | [tests](../shell/src/core/cores/notification.test.ts) |
| Media | byte detection, safe playback, metadata | [media.ts](../shell/src/core/cores/media.ts) | [tests](../shell/src/core/cores/media.test.ts) |
| Dev | artifacts, validation/sandbox/install/rollback, widget RPC | [dev.ts](../shell/src/core/cores/dev.ts) | [tests](../shell/src/core/cores/dev.test.ts) |

## Working independently

Use the commands in [the Locus README](../README.md). Source imports, package
resolution, tests, design docs, and image planning all stay within this checkout.
There is no submodule, symlink, sibling-relative build input, or remote source
fetch. The old repo URL and original hashes in [shell-import.json](shell-import.json)
exist solely for attribution and optional historical comparison. Future fixes
and specification updates belong in this repository.
