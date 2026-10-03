/*
 * The Core registry — the Core API Focus List as data.
 * ---------------------------------------------------------------------------
 * The OS is three layers: the System Layer (here, the browser + core/storage),
 * the Core Services Layer (this directory), and the App Layer (src/apps).
 * Apps are the user-facing surfaces; Cores are the shared contracts
 * underneath them. Apps use Cores whenever possible instead of rebuilding
 * private systems, and the AI must build with Cores instead of bypassing them.
 *
 * A capability becomes a Core when several of these are true: multiple apps
 * need it; it owns a source of truth that should not be duplicated; AI needs
 * to read, reason over, or act through it; it needs permission checks, audit,
 * approval, undo, redaction, or sandboxing; generated apps/widgets/anchors
 * are safer if it already exists.
 *
 * Every Core is declared here with its focus, owned data, events,
 * permissions, dependents, the way AI should use it, and its boundary (the
 * "do not" from the Focus List). The Cores app renders this registry, so the
 * architecture is inspectable from inside the OS.
 */

export type CoreId =
  | "time"
  | "cardspoke"
  | "editor"
  | "files"
  | "search"
  | "people"
  | "monitor"
  | "web"
  | "ai"
  | "secrets"
  | "security"
  | "notification"
  | "media"
  | "dev";

/** How far along a Core's implementation is. Honest, like app status badges. */
export type CoreStatus = "functional" | "minimal" | "interface";

export interface CoreDefinition {
  id: CoreId;
  name: string;
  icon: string;
  purpose: string;
  /** The data and behavior this Core owns. */
  owns: string[];
  /** Events this Core emits (Rule 3: everything emits useful events). */
  events: string[];
  /** Permissions this Core requires or brokers. */
  permissions: string[];
  /** Apps and surfaces that depend on it. */
  usedBy: string[];
  /** How AI should use this Core (Focus List). */
  aiUse: string;
  /** The Focus List's boundary — what this Core must not become. */
  boundary: string;
  status: CoreStatus;
  /** Where this Core goes next. */
  future: string[];
}

export const CORES: CoreDefinition[] = [
  {
    id: "time",
    name: "Time Core",
    icon: "◔",
    purpose:
      "OS-wide time, dates, schedules, reminders, alarms, timers, recurrence, and time-based triggers. “When” is a shared system concept instead of Tasks, Calendar, Monitor, and AI each inventing schedule logic.",
    owns: [
      "current time & formatting preferences (12/24h applies system-wide)",
      "local-date correctness for the whole OS (todayLocal / daysSince — F2)",
      "alarms", "timers", "calendar events", "reminders",
      "recurrence: daily / weekly / monthly / yearly, advanced by wall clock (DST-safe, Feb-29 clamped)",
      "durable timed triggers with a persisted DISPATCH OUTBOX: every targetCore firing records a dispatch before consumers run, consumers ack by returning, failures retry with backoff and dead-letter visibly (People Core consumes birthday reminders via onCoreDispatch)",
      "reschedule / snooze of any entry; missed-while-away state (recurring occurrences retain lastMissedAt); explicit DST gap/fold policy in recurrence",
      "the OS's one elected scheduler — other Cores register jobs on it",
    ],
    events: ["time.entry.fired", "time.entry.missed", "time.entry.created", "time.entry.rescheduled", "time.entry.cancelled"],
    permissions: ["local storage of time entries", "delivery via Notification Core (quiet-hours aware)"],
    usedBy: ["Time", "Tasks", "Monitor (evaluator job)", "Notifications (release job)", "People (birthdays)", "Dashboard", "AI Assistant"],
    aiUse:
      "Propose reminders, schedule follow-ups, reason about deadlines, create time-based watches, and explain upcoming commitments (describeUpcoming).",
    boundary: "Not a full productivity app — Calendar, Tasks, and Dashboard are surfaces over it.",
    status: "functional",
    future: ["full calendar views", "interval recurrence", "availability & routines", "maintenance windows"],
  },
  {
    id: "cardspoke",
    name: "Cardspoke Core",
    icon: "▢",
    purpose:
      "Shared structured user information: cards, notes, tasks, lightweight documents, links, backlinks, tags, and conversions between information shapes — user-created knowledge portable across apps, modeled on the CardSpoke app's reusable core.",
    owns: [
      "cards / notes / task objects / document sections",
      "tags (#inline-tags extracted on save) & [[wiki-links]] with backlinks",
      "related-object discovery by shared tags",
      "lossless reversible conversions (the whole previous sub-record is snapshotted)",
      "typed queries: due today, overdue (local days), by type+tag",
      "persisted saved filters (named collections — surfaced in Tasks: save/apply/remove a done+tag filter)",
      "outline → tasks transformation (idempotent — surfaced in Cards as “→ Tasks (outline)”)",
      "recoverable trash for card/task/document (deleteCard trashes; restore + token-gated purge; the generic object trash the shared store owns)",
    ],
    events: ["object.created", "object.updated", "object.converted", "object.deleted"],
    permissions: ["read/write the local object store"],
    usedBy: ["Cards", "Tasks", "Search", "People (notes cards)", "AI Assistant"],
    aiUse:
      "Create, link, summarize, transform, and retrieve structured user objects (createCard, linksFor/backlinksFor, convertCard/revertConversion, evaluateFilter, cardForAI).",
    boundary:
      "Not responsible for editing mechanics (Editor Core), file bytes (Files Core), or app-specific presentation.",
    status: "functional",
    future: ["decks & boards", "slide objects", "card history", "templates", "knowledge repository entries"],
  },
  {
    id: "editor",
    name: "Editor Core",
    icon: "✎",
    purpose:
      "Shared editing behavior for text and editable artifacts: selection, undo/redo, transformations, suggestions, export, and AI edit transactions — how edits happen, preview, and undo.",
    owns: [
      "text editing & selection model",
      "undo/redo stacks (Writer's Transform menu runs on one)",
      "shared transformations (case, line cleanup)",
      "AI edit transactions: original-offset ops, overlap rejection, stale-base detection via a monotonic object revision (baseRev — same-millisecond edits are still caught)",
      "line-diff previews rendered in the Approvals panel before anything applies",
      "the diff grammar Dev Core reuses for code",
      "export operations",
    ],
    events: ["editor.transaction.proposed", "editor.exported"],
    permissions: ["propose changes only through the AI Broker"],
    usedBy: ["Writer", "Dev Core (diffs)", "Assistant (diff preview)", "future Printer / Image / Video / DAW editors"],
    aiUse:
      "Rewrites, text cleanup, insertions, document restructuring, diff previews, and proposal-based edits (proposeEditTransaction, previewTransaction).",
    boundary:
      "Does not own the content model: Cardspoke owns structured objects, Files owns file references, Dev Core owns runnable code artifacts.",
    status: "functional",
    future: ["comments & suggestions", "Printer (print/layout editor)", "snapping/guides for canvas editors", "version history hooks"],
  },
  {
    id: "files",
    name: "Files Core",
    icon: "▚",
    purpose:
      "The common file authority: files, folders, file references, metadata, previews, recents, trash/restore, source grants, and file change events — user-granted file/source capability, not “localStorage rows”.",
    owns: [
      "file metadata entries", "recent files", "file references",
      "real local bytes (Phase 1: Files, Media, And Real Local Bytes) — core/byteStore.ts, OPFS-or-IndexedDB chosen once per session, one byte payload per file id; importFileBytes writes them and decides kind from content (magic numbers), falling back to extension only when the bytes are not recognized media",
      "trash & recovery (deletedAt lifecycle; the Files app has no other delete path; permanent empty-trash is token-gated and now purges stored bytes, not just the metadata object)",
      "typed file change events",
      "source grants (readable connected sources)",
      "brokered access requests → approval MINTS a revocable, expiring one-shot grant; openFileWithGrant CONSUMES it at read time (re-validating trash/source) and now releases real bytes + content-detected MIME for byte-backed files, alongside the redacted metadata — mint and consume stay separate steps",
      "AI-readable metadata (redaction-aware via Secrets Core)",
    ],
    events: ["file.added", "file.imported", "file.renamed", "file.trashed", "file.restored", "file.access.requested", "file.access.granted"],
    permissions: ["local object store (file type)", "local byte store (OPFS/IndexedDB)", "future native filesystem / cloud mounts / app sandboxes"],
    usedBy: ["Files", "Search (trash filter)", "Media Core", "Dashboard (Files tile)", "Music tile (via Media Core)"],
    aiUse:
      "Reason about granted scopes (sourceGrants), propose file organization, summarize indexed metadata (fileMetaForAI), and request brokered access (requestFileAccess) — never touches bytes directly even now that they are real.",
    boundary:
      "The browser implementation (OPFS/IndexedDB byte store) is only the first version — the concept is user-granted file/source capability that later maps to native filesystems and cloud mounts; per-file download is an app-level affordance (Files.tsx), not a Core API.",
    status: "functional",
    future: ["external drives & cloud mounts", "folder import / File System Access picker", "previews", "sync hooks"],
  },
  {
    id: "search",
    name: "Search / Index Core",
    icon: "⌕",
    purpose:
      "OS-wide search, indexing, source metadata, ranking, recents, relationship discovery, and redaction-aware retrieval — all user-authorized context findable through one path.",
    owns: [
      "unified search: apps, objects, contacts — the Search app and the assistant both use it",
      "query grammar (type: / tag: / before: / after:, local days, inclusive; errors surfaced, space-after-colon tolerated)",
      "ranking (match position + recency)",
      "relationship discovery (links, backlinks, projects, tags); relationshipsForAI returns redacted, source-authorized DTOs",
      "a separate AI retrieval path (retrieveForAI) returning redacted, source-authorized DTOs — no raw SystemObject crosses the AI boundary; user search and AI retrieval are distinct APIs",
      "exclusion provenance (user / source-pattern / trash): a full pass lifts only its own source-pattern exclusions; user exclusions and trash are never revived",
      "recents & source labels; trashed objects (files and generic trash) never surface",
      "debounced auto-reindex of stale objects",
    ],
    events: ["index.updated", "search.performed"],
    permissions: ["read the object store", "respect Secrets Core redaction rules", "respect index exclusions"],
    usedBy: ["Search", "AI Assistant (retrieval + context snippets)"],
    aiUse:
      "Retrieve relevant context, build context packets (buildContextSnippets), cite local sources, find relationships (relationshipsFor), and respect source exclusions.",
    boundary:
      "No app builds a private index unless it reports into the shared index.",
    status: "functional",
    future: ["semantic search", "temporal natural-language search (“files from yesterday”)", "AI summaries for results"],
  },
  {
    id: "people",
    name: "People Core",
    icon: "◉",
    purpose:
      "People as a system-level concept: contacts, identities, groups, relationships, birthdays, cadence, interaction history, and people-linked notes or tasks — the interaction model shaped by Pal-Plant.",
    owns: [
      "contacts (names, nicknames, phones, emails, socials — sensitive edits audited)",
      "categories & groups", "birthdays (Feb-29 clamps to Feb 28 off-leap-years)",
      "yearly birthday reminders materialized into Time Core, reconciled on a daily scheduler job (not just at boot — a long-running session schedules past the horizon)",
      "interaction history with channels (in-person/call/video/text)",
      "per-contact follow-up cadence & cadence health (never-contacted is explicit)",
      "a typed person↔object relationship table (link kinds, reverse lookup, referential repair on delete/trash; legacy notesCardId migrated in)",
      "archive/restore",
    ],
    events: ["contact.created", "contact.updated", "contact.removed", "contact.interaction.logged"],
    permissions: ["local storage of contacts", "contact details exposed to AI only via approval"],
    usedBy: ["Contacts", "Monitor (cadence watches)", "AI Assistant (contactForAI, follow-ups)"],
    aiUse:
      "Suggest follow-ups, draft reminders, link notes to people, reason about relationship context (contactForAI: identity + cadence only — details need approval).",
    boundary: "Not a messaging app — messaging, email, and social surfaces use it.",
    status: "functional",
    future: ["Plant Pal", "mail/calendar integration", "richer interaction logs", "communication references"],
  },
  {
    id: "monitor",
    name: "Monitor Core",
    icon: "◎",
    purpose:
      "The personal observability layer: watches, conditions, triggers, health checks, status changes, stale items, overdue work, recurring evaluations, and alert history — it watches conditions across other Cores and tells Notification Core when attention is needed.",
    owns: [
      "watches (name, source, condition, frequency, severity — all editable after creation)",
      "status checks, schedules & snooze; pause is a mute, not a reset",
      "trigger fingerprints (a new cause re-alerts mid-warning); event-style file-change alerts",
      "cooldown (minIntervalMs) and escalation (warning → critical after N fails)",
      "missing-target detection (auto-disables instead of warning forever)",
      "watch history",
      "watch types: storage, task deadlines, file changes, stale items, contact cadence, webpage reachability (opt-in HEAD check)",
      "“Monitor this” entry points & suggested watches",
    ],
    events: ["monitor.triggered", "monitor.recovered", "monitor.checked"],
    permissions: ["read other Cores' data to evaluate conditions (overdue math comes from Cardspoke)", "deliver alerts via Notification Core", "evaluates as a job on Time Core's scheduler"],
    usedBy: ["Monitor", "Tasks (deadline watch)", "Contacts (cadence watch)", "Browser (page watches)"],
    aiUse:
      "Propose watches through an approved proposal (requestWatchCreation → a brokered monitor.createWatch; a direct createWatch with createdBy: \"ai\" is refused), summarize changes, detect stale workflows, and help users turn concerns into observable conditions.",
    boundary:
      "It observes and triggers; other Cores own the domain state — it does not decide product behavior.",
    status: "functional",
    future: ["page content-change watches (needs an engine)", "device health (CPU/RAM/temperature)", "per-watch cooldown/escalation UI"],
  },
  {
    id: "web",
    name: "Web Core",
    icon: "◍",
    purpose:
      "Web capability as a shared OS service: web apps, PWAs, URLs, embedded web surfaces, web permissions, session behavior, downloads, and page metadata — one governed web layer for every surface.",
    owns: [
      "web app / PWA shortcut model (URLs validated + allowlisted http/https; de-duplicated)",
      "session opening (new-tab today; embedded engines later); opens history",
      "permissioned page-context requests (through AI Core → Broker) → approved requests really capture title/meta (or record the CORS block honestly); readable captures feed the assembled AI context packet",
      "page reachability watches (created in Monitor Core, opt-in checks)",
    ],
    events: ["webapp.added", "webapp.removed", "webapp.opened", "web.pageContext.requested", "web.pageContext.captured"],
    permissions: ["open external URLs on user action only", "page context only via approved proposals"],
    usedBy: ["Browser", "Cores app (live counts)"],
    aiUse:
      "Propose web app shortcuts, request permissioned page context (requestPageContext), create watches over web resources (createPageWatch), open URLs only through approved user action.",
    boundary: "Never an ungoverned scraper or hidden browser for AI.",
    status: "minimal",
    future: ["embedded engine strategy (Chromium/Servo/WebKit)", "real PWA install", "downloads, history, web permissions"],
  },
  {
    id: "ai",
    name: "AI Core",
    icon: "◐",
    purpose:
      "The OS-level intelligence layer: context assembly, model routing, assistant state, action planning, proposal creation, Core routing rules, and AI-visible system contracts. It coordinates, proposes, and routes — it does not mutate directly.",
    owns: [
      "assistant interface & context packet assembly (built from the Cores' own AI views: describeUpcoming, cardForAI, contactForAI, listRefsForAI)",
      "model routing rules (keyword → local/cloud) with a Control Center UI — consulted on every assistant request (the “via:” line)",
      "action proposal lifecycle: every AI write flows AI Core → Security gate → Broker — Editor, Files, Web, Monitor, and Secrets requests all route through proposeThroughCore, which derives the verified originCore from the Action Definition registry",
      "the Core routing table (edits → Editor, code → Dev, reminders → Time, secrets → Secrets…); keyword routing matches whole words, not substrings",
      "an opt-in real model runtime (core/modelRuntime.ts): disabled by default, gated behind canDispatch() (provider set + runtime enabled + a parsed endpoint, with a remote endpoint additionally requiring the Cloud provider AND an explicit re-ackable acknowledgment before any local context leaves the device); an API key reaches it only via a brokered secrets.use proposal that arms an in-memory session key, never persisted or logged; every dispatch is audited with model/host/outcome/timing, never the prompt or response body",
      "logs of AI actions (audit spine)",
    ],
    events: ["ai.proposed", "ai.approved", "ai.denied", "ai.executed", "ai.refused", "ai.routed", "ai.dispatched", "ai.undone"],
    permissions: ["read only what effective permissions allow", "write only through approved proposals"],
    usedBy: ["AI Assistant", "AI Control Center"],
    aiUse:
      "Understand the environment, pick a route (suggestRoute), then act through other Cores: edits through Editor, code through Dev, reminders through Time, files through Files, secrets through Secrets, alerts through Notification.",
    boundary: "Does not directly mutate everything — it coordinates, proposes, and routes.",
    status: "functional",
    future: ["screen/app awareness", "app-specific AI skills", "streaming responses", "multi-turn conversation memory"],
  },
  {
    id: "secrets",
    name: "Secrets Core",
    icon: "◈",
    purpose:
      "Secrets, credentials, tokens, passkeys, secret references, brokered secret use, redaction, reveal events, and secret-use audit — the OS uses sensitive values without exposing them to apps or AI.",
    owns: [
      "secret references (secret://provider/name — unique; re-adding rotates the value)",
      "encryption at rest: PBKDF2 (600k iterations) → non-extractable AES-GCM key, per-value IV, AAD-BOUND to the secret id (a swapped ciphertext fails authentication), idle auto-lock; enc1/pre-encryption items migrate on unlock; partial unlocks are reported",
      "recoverable delete: removeSecret moves the encrypted item to a vault trash with restore + token-gated permanent purge",
      "REAL brokered use: requestSecretUse creates a typed secrets.use proposal; only the internal executor decrypts and delivers the value once to a registered consumer (never the caller, never persisted); with no consumer runtime the approved use fails honestly",
      "reference-existence checks for AI (never values)",
      "leak/redaction detector (OpenAI/Stripe/Google/GitHub/GitLab/npm/SendGrid/AWS/Slack/JWT/connection strings/private keys/bearer) — vault-aware while unlocked",
      "one redaction choke point: proposals, notifications, audit rows, search, and AI context all pass through it",
      "audit trail of every add, use, denial, reveal, lock, and unlock",
    ],
    events: ["secret.added", "secret.removed", "secret.used", "secret.use_denied", "secret.revealed", "secret.access_changed", "vault.locked", "vault.unlocked"],
    permissions: ["encrypted local secret store", "audit logging"],
    usedBy: ["Vault", "AI context assembly", "Search (redaction)", "Files Core", "Broker (F5 redaction)", "Audit log (redaction)", "Notification Core (redaction)", "Dev Core (leak scan)"],
    aiUse:
      "Request brokered actions (useSecretBrokered), check whether a reference exists (secretRefExists, listRefsForAI), propose credential setup — never read raw values.",
    boundary: "Secrets are never stored as ordinary objects or file metadata.",
    status: "functional",
    future: ["passkeys", "rotation reminders via Time Core", "scoped env injection into Dev sandbox runs", "off-device broker integration"],
  },
  {
    id: "security",
    name: "Security Core",
    icon: "▣",
    purpose:
      "The policy authority: permissions, trust levels, risk classification, sandbox policy, approval rules, app install safety, trusted actions, and capability enforcement. Apps declare capabilities; Security Core decides effective policy.",
    owns: [
      "app & AI permission model (five capability tiers, enforced at the broker gate)",
      "a typed Action Definition registry (core/actionRegistry) binding each actionType to owner Core, permitted apps, effect kind, object/target types, payload-field allowlist, executor owner, governing labels, and risk/undo — the structural contract authorization enforces",
      "the broker gate (F3): authorizeProposal at propose, approve, AND execute, structural + fail-closed — unknown actions, a spoofed app, a mismatched effect kind, a disallowed object/target type, an undeclared payload field, or a caller-asserted readOnly that disagrees with the definition all DENY; risk + undo come from the definition",
      "trusted-action scope: deletes/external never auto-run unless the trusted action explicitly covers that effect kind",
      "real undo: update/delete effects snapshot prior state at execution; undoProposal restores it",
      "sandbox policy for generated code (dependency allowlist, network deny enforced by the sandbox CSP)",
      "canonical permission vocabulary (<core>.<read|write|delete|reference>) — a manifest requesting “everything” fails",
      "approval prompt format (risk, data touched, undo note — rendered in Approvals)",
    ],
    events: ["permission.changed", "trusted_action.run", "ai.refused", "manifest.evaluated"],
    permissions: ["read/write permission overrides", "gate the AI Broker (consulted at propose/approve/execute)", "gate Dev Core installs"],
    usedBy: ["AI Broker (the gate)", "Dev Core (manifest checks)", "Assistant (approval prompts)", "AI Control Center (tier ladder via core/permissions)"],
    aiUse:
      "Learn whether an action is readable, suggestible, writable with approval, trusted, or forbidden (classifyRisk, evaluateManifest) — and explain why a request needs approval.",
    boundary:
      "Security rules are not buried inside individual apps — apps declare capabilities; this Core decides effective policy.",
    status: "functional",
    future: ["OS-level sandboxing", "app install safety scans", "network/device access policies", "integrity checks"],
  },
  {
    id: "notification",
    name: "Notification Core",
    icon: "◌",
    purpose:
      "Alerts, reminders, status messages, user attention requests, notification history, priority, snooze, grouping, and delivery surfaces — consistent attention delivery across the OS.",
    owns: [
      "notification objects (title/body/source/priority) with declarative action buttons (open-app, snooze-entry)",
      "history; snooze-aware unread counts (every surface uses them)",
      "quiet hours with a Settings panel — policy HOLDS (heldUntil) are a separate field from user SNOOZES (snoozedUntil); a quiet-hours change reconciles holds without touching snoozes; critical breaks through",
      "per-source mute (history, no attention)",
      "pending-vs-history eviction: the cap evicts READ history only — unread, held, and critical items are never dropped",
      "grouping by source (the large tile renders it)",
    ],
    events: ["notification.delivered", "notification.snoozed"],
    permissions: ["local notification history", "deliver() is the only public send path — raw notify is private"],
    usedBy: ["Time", "Monitor", "Dev", "AI Broker", "Secrets", "Settings", "Desktop shell", "header segments", "Notifications tile"],
    aiUse:
      "Propose or send approved notifications through deliver(), explain why something needs attention, and respect quiet hours and notification policy.",
    boundary: "It does not decide what matters — other Cores decide that; this Core delivers it.",
    status: "functional",
    future: ["richer action vocabulary", "OS-level push"],
  },
  {
    id: "media",
    name: "Media Core",
    icon: "▶",
    purpose:
      "Images, audio, video, playback, recording, media metadata, thumbnails, waveform/timeline primitives, and media permissions — media handling reusable across Files, Viewer, Screen, Music, and generated widgets.",
    owns: [
      "media kind recognition (image/audio/video, wide extension coverage); content-based detection from bytes (magic numbers) when bytes exist — content is evidence, an extension is only a claim",
      "honest playback-support detection — a real canPlayType probe per format/MIME",
      "media metadata over the shared file store (trash excluded) — the Files app and Music tile render it; mediaMetaForStored reads a byte-backed file's real content (via Files Core's byte store) instead of trusting its name",
      "real playback (Phase 1: Files, Media, And Real Local Bytes) — mediaUrlFor wraps a byte-backed file's stored bytes in a Blob URL for <img>/<audio>/<video>; releaseMediaUrl frees it. A deliberately DOM-only seam (Blob/URL), not a Core-portable API",
      "thumbnail generation placeholder (still needs a real decode/resize path, not just bytes)",
      "media permission seam wrapping the Permissions API (camera/mic; screen-capture prompts per use)",
    ],
    events: ["media.playback.started (future)", "media.imported (future)"],
    permissions: ["camera/microphone only after explicit grants"],
    usedBy: ["Music tile (real playback for byte-backed tracks)", "Files (grant preview)", "future Viewer/Screen surfaces", "future Photos/Video/DAW"],
    aiUse:
      "Inspect allowed media metadata (mediaMetaFor, mediaMetaForStored, listMediaFiles), generate previews, and route media creation/editing through governed operations when permitted.",
    boundary: "Not a single media app — Photos, Music, Video, Viewer, and editors are surfaces over it. mediaUrlFor is a browser-phase convenience, not a substitute for a real playback service.",
    status: "minimal",
    future: ["real playback service (queues, background audio, hardware output selection)", "waveform/timeline primitives", "media library indexing", "codecs strategy", "real thumbnails"],
  },
  {
    id: "dev",
    name: "Dev Core",
    icon: "⌘",
    purpose:
      "The system contract for software creation inside Locus: code artifacts, generated apps, widgets, anchors, manifests, diffs, previews, sandboxed execution, validation, packaging, dependency policy, provenance, and rollback — a governed pipeline from proposal to install.",
    owns: [
      "code artifacts: apps, widgets, anchors, snippets — with capability manifests (canonical permission vocabulary)",
      "diffs & generated-change summaries (Editor Core's diff grammar)",
      "validation: manifest, dependency allowlist, secret-leak scan, size (globals scan is advisory — the CSP enforces)",
      "sandboxed execution: opaque-origin iframe + CSP network deny + Worker isolation, with VERDICT INTEGRITY — the harness binds a private completion channel in a closure and stamps a per-run nonce, so artifact code cannot forge a successful run via send('done'), postMessage, or a re-acquired channel (a busy-loop cannot hang the OS; </script> cannot escape; async rejections fail the run)",
      "packaging: install requires passing validation AND a successful sandbox run of the current code",
      `provenance: prompt, model, creator, the last 25 versions as rollback points, audit trail`,
      "policy hooks: Security Core's sandbox policy enforced at validation and runtime",
      "devwidget tile runtime: installed widgets render in an iframe+CSP sandboxed desktop tile (buildWidgetSrcdoc), with a fixed, manifest-gated, read-only RPC vocabulary (WIDGET_RPC_KINDS/handleWidgetRpc) as the artifact's only channel off the page — denials are audited (successes are not, to keep the log signal)",
    ],
    events: ["dev.artifact.created", "dev.artifact.updated", "dev.validated", "dev.sandbox.run", "dev.installed", "dev.uninstalled", "dev.rolledback", "dev.removed", "dev.widget.denied"],
    permissions: ["local artifact store", "Security Core manifest checks", "installs are user decisions (proposal-gated for AI)", "devwidget RPC requires the manifest permission the requested kind declares"],
    usedBy: ["Cores app (artifact inspector: validate, sandbox-run, install/uninstall, rollback, remove)", "Dev app (authoring: create, diff-first code edits, validate, run, install, place on desktop)", "AI Broker (dev.install executor)", "devwidget tiles (installed widgets placed on the desktop)"],
    aiUse:
      "Scaffold apps, generate widgets, create anchors, edit code (diff first), run checks (validateArtifact), capture logs (runInSandbox), and package artifacts into the registry (installArtifact — on approval).",
    boundary:
      "Not just a code editor — Editor Core can edit text; Dev Core understands runnable software and governs generated behavior.",
    status: "functional",
    future: ["typecheck/lint/test runners", "dependency bundling", "a widget write-path RPC via AI proposals (today the devwidget RPC is read-only)"],
  },
];

const BY_ID = new Map<CoreId, CoreDefinition>(CORES.map((c) => [c.id, c]));

export function getCore(id: CoreId): CoreDefinition {
  return BY_ID.get(id)!;
}
