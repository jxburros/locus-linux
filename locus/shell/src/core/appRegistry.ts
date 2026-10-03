/*
 * The app registry.
 * ---------------------------------------------------------------------------
 * One array of AppModule objects is the system's map of itself. The launcher,
 * home screen, command palette, search, and AI Control Center all read from
 * here, so adding an app means adding its component and one manifest entry.
 */

import type { AppId, AppModule } from "@/types";

import Writer from "@/apps/writer/Writer";
import Cards from "@/apps/cards/Cards";
import Tasks from "@/apps/tasks/Tasks";
import Projects from "@/apps/projects/Projects";
import Files from "@/apps/files/Files";
import Time from "@/apps/time/Time";
import Monitor from "@/apps/monitor/Monitor";
import Vault from "@/apps/vault/Vault";
import People from "@/apps/people/People";
import Browser from "@/apps/web/Browser";
import Search from "@/apps/search/Search";
import Assistant from "@/apps/assistant/Assistant";
import AIControlCenter from "@/apps/ai-control/AIControlCenter";
import Sources from "@/apps/sources/Sources";
import Settings from "@/apps/settings/Settings";
import AuditLog from "@/apps/audit-log/AuditLog";
import Platform from "@/apps/platform/Platform";
import Cores from "@/apps/cores/Cores";
import DevApp from "@/apps/dev/DevApp";
import {
  TasksPreview,
  WriterPreview,
  CardsPreview,
  FilesPreview,
  SearchPreview,
} from "@/components/anchors/previews";

export const APPS: AppModule[] = [
  {
    id: "writer",
    name: "Writer",
    description: "Markdown documents you own as plain text.",
    icon: "Wr",
    category: "workspace",
    status: "beta",
    component: Writer,
    keywords: ["document", "markdown", "write", "notes", "editor"],
    anchor: { eligible: true, defaultSpan: { col: 3, row: 2 }, preview: WriterPreview },
    permissions: {
      localData: ["documents", "drafts", "document metadata", "project links"],
      device: ["keyboard input", "clipboard on user action"],
      network: [],
      ai: {
        readable: ["Connected document titles", "Connected document body text", "Writer metadata and tags"],
        suggestible: ["Rewrite a passage", "Summarize the document", "Fix spelling and grammar", "Extract tasks"],
        writableWithApproval: ["Apply an accepted rewrite", "Insert generated text", "Create a new document version"],
        trusted: ["Render Markdown preview locally"],
        forbidden: ["Delete a document", "Export or send a document without explicit user action"],
      },
    },
  },
  {
    id: "cards",
    name: "Cards",
    description: "A card-based knowledge and memory layer.",
    icon: "Ca",
    category: "workspace",
    status: "stub",
    component: Cards,
    keywords: ["knowledge", "memory", "notes", "cardspoke", "zettel"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 }, preview: CardsPreview },
    permissions: {
      localData: ["cards", "tags", "links", "card metadata"],
      device: ["keyboard input"],
      network: [],
      ai: {
        readable: ["Connected card titles", "Connected card bodies", "Card tags and backlinks"],
        suggestible: ["Suggest tags", "Suggest links between cards", "Draft a new card", "Surface memory candidates"],
        writableWithApproval: [
          "Create a card",
          "Add tags to a card",
          "Merge duplicate cards",
          "Edit a card's body via an approved proposal",
        ],
        trusted: ["Sort visible cards and prepare local previews"],
        forbidden: ["Delete a card", "Publish cards to an external provider"],
      },
    },
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Simple, fast action management.",
    icon: "Ta",
    category: "workspace",
    status: "stub",
    component: Tasks,
    keywords: ["todo", "task", "action", "checklist"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 2 }, preview: TasksPreview },
    permissions: {
      localData: ["tasks", "task status", "priorities", "project links"],
      device: ["keyboard input"],
      network: [],
      ai: {
        readable: ["Connected task lists", "Task status", "Project-scoped tasks"],
        suggestible: ["Break a task into subtasks", "Draft new tasks from a note", "Suggest priorities"],
        writableWithApproval: [
          "Create a task",
          "Update task status",
          "Attach a task to a project",
          "Edit a task's body via an approved proposal",
        ],
        trusted: ["Reorder visible tasks by chosen sort"],
        forbidden: ["Delete a task", "Mark tasks complete without a user-trusted rule"],
      },
    },
  },
  {
    id: "projects",
    name: "Projects",
    description: "Hubs linking documents, cards, tasks, and files.",
    icon: "Pr",
    category: "workspace",
    status: "stub",
    component: Projects,
    keywords: ["project", "hub", "workspace", "context"],
    permissions: {
      localData: ["projects", "project links", "decisions", "changelog", "context packs"],
      device: ["keyboard input"],
      network: [],
      ai: {
        readable: ["Connected project context packs", "Linked object counts", "Project summaries and decisions"],
        suggestible: ["Suggest next steps", "Draft a project summary", "Identify missing links and risks"],
        writableWithApproval: ["Link an object to a project", "Add a decision record", "Create project tasks"],
        trusted: ["Assemble a read-only project context pack"],
        forbidden: ["Delete project contents", "Share project context with a cloud model without explicit approval"],
      },
    },
  },
  {
    id: "files",
    name: "Files",
    description: "Local-first file organization.",
    icon: "Fi",
    category: "workspace",
    status: "stub",
    component: Files,
    keywords: ["files", "folders", "storage", "documents", "indexing"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 }, preview: FilesPreview },
    permissions: {
      localData: ["file index", "collections", "tags", "recent files", "derived summaries"],
      device: ["file picker on user action", "connected source scan when enabled"],
      network: [],
      ai: {
        readable: ["Connected file names", "Connected file contents", "File metadata, tags, and summaries"],
        suggestible: ["Suggest a folder structure", "Suggest tags and collections", "Summarize indexed files"],
        writableWithApproval: ["Rename indexed files", "Add tags", "Move a file into a collection"],
        trusted: ["Index connected sources on schedule", "Generate local metadata for new files"],
        forbidden: ["Delete files", "Upload files anywhere", "Read outside connected sources"],
      },
    },
  },
  {
    id: "time",
    name: "Time",
    description: "Alarms, timers, events, and reminders on Time Core.",
    icon: "◔",
    category: "workspace",
    status: "beta",
    component: Time,
    keywords: ["time", "clock", "calendar", "alarm", "timer", "stopwatch", "reminder", "schedule"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 } },
    permissions: {
      localData: ["alarms", "timers", "events", "reminders", "time format preference"],
      device: ["local clock"],
      network: [],
      ai: {
        readable: ["Upcoming alarms, events, and reminders", "Time format preference"],
        suggestible: ["Suggest a reminder time", "Draft an event from a note"],
        writableWithApproval: ["Create a reminder", "Create an event", "Cancel a timer"],
        trusted: [],
        forbidden: ["Silence alarms without user action", "Change the system clock"],
      },
    },
  },
  {
    id: "monitor",
    name: "Monitor",
    description: "Personal observability — watches, alerts, history.",
    icon: "◎",
    category: "workspace",
    status: "beta",
    component: Monitor,
    keywords: ["monitor", "watch", "alert", "observability", "stale", "overdue", "nagios"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 } },
    permissions: {
      localData: ["watches", "watch history", "check schedules"],
      device: ["local storage usage estimate"],
      network: ["future webpage checks"],
      ai: {
        readable: ["Watch list and statuses", "Recent trigger history"],
        suggestible: ["Suggest a watch for something visible", "Summarize what changed"],
        writableWithApproval: ["Create a watch", "Pause or resume a watch"],
        trusted: [],
        forbidden: ["Delete watch history", "Suppress alerts silently"],
      },
    },
  },
  {
    id: "vault",
    name: "Vault",
    description: "Secrets by reference — used, never exposed.",
    icon: "◈",
    category: "system",
    status: "beta",
    component: Vault,
    keywords: ["vault", "secrets", "passwords", "api keys", "tokens", "credentials", "redaction"],
    permissions: {
      localData: ["secret references", "secret metadata", "values encrypted at rest (AES-GCM, AAD-bound)"],
      device: [],
      network: [],
      ai: {
        readable: ["That secret references exist (names only)"],
        suggestible: ["Suggest storing a detected secret", "Suggest rotating an old secret"],
        writableWithApproval: ["Use a secret via brokered access (value never shown)"],
        trusted: [],
        forbidden: ["Read raw secret values", "Reveal a secret", "Export secrets anywhere"],
      },
    },
  },
  {
    id: "people",
    name: "Contacts",
    description: "People, groups, and follow-up cadence on People Core.",
    icon: "◉",
    category: "workspace",
    status: "beta",
    component: People,
    keywords: ["contacts", "people", "friends", "groups", "birthday", "follow up", "plant pal"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 } },
    permissions: {
      localData: ["contacts", "categories", "groups", "last-contact dates", "notes links"],
      device: [],
      network: [],
      ai: {
        readable: ["Contact names, categories, and groups", "Follow-up staleness"],
        suggestible: ["Suggest a follow-up", "Draft a birthday reminder"],
        writableWithApproval: ["Create a contact note card", "Set a birthday reminder"],
        trusted: [],
        forbidden: ["Delete contacts", "Share contact details externally"],
      },
    },
  },
  {
    id: "web",
    name: "Browser",
    description: "Web apps and PWAs as first-class shortcuts (Web Core).",
    icon: "◍",
    category: "workspace",
    status: "stub",
    component: Browser,
    keywords: ["browser", "web", "pwa", "url", "internet", "bookmarks", "web apps"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 } },
    permissions: {
      localData: ["saved web apps", "open history (audit log)"],
      device: [],
      network: ["opens external URLs in a new tab on user action"],
      ai: {
        readable: ["Saved web app names and URLs"],
        suggestible: ["Suggest a web app to pin"],
        writableWithApproval: [
          "Add a web app shortcut",
          // The honest label for what web.pageContext actually does: an
          // approved, redacted title/description capture — never full page
          // contents, which stay forbidden below.
          "Capture page title and description via an approved request",
        ],
        trusted: [],
        forbidden: ["Open a URL without user action", "Read full page contents (no engine yet)"],
      },
    },
  },
  {
    id: "search",
    name: "Search",
    description: "Find anything across the system.",
    icon: "Se",
    category: "system",
    status: "stub",
    component: Search,
    keywords: ["search", "find", "query", "lookup", "semantic"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 1 }, preview: SearchPreview },
    permissions: {
      localData: ["local search index", "recent queries", "object metadata"],
      device: ["keyboard input"],
      network: [],
      ai: {
        readable: ["Search queries", "Local index entries", "Selected result context"],
        suggestible: ["Suggest better search terms", "Rewrite natural language queries"],
        writableWithApproval: ["Save searches", "Create smart collections"],
        trusted: ["Rank local results"],
        forbidden: ["Send global search history to external providers by default"],
      },
    },
  },
  {
    id: "assistant",
    name: "AI Assistant",
    description: "Ask, inspect context, and approve changes.",
    icon: "◐",
    category: "workspace",
    status: "beta",
    component: Assistant,
    keywords: ["ai", "assistant", "chat", "context", "approvals", "memory", "propose"],
    anchor: { eligible: true, defaultSpan: { col: 2, row: 2 } },
    permissions: {
      localData: ["memory", "proposals", "context scope", "assistant history"],
      device: ["keyboard input"],
      network: ["future model provider endpoints after configuration"],
      ai: {
        readable: ["Assembled context packet", "Editable memory", "Recent activity in scope"],
        suggestible: ["Answer from local context", "Draft a change as a proposal"],
        writableWithApproval: [
          "Create or edit objects via an approved proposal",
          "Install a validated Dev artifact after approval",
        ],
        trusted: ["Assemble a read-only context packet"],
        forbidden: ["Change data without a proposal", "Send anything externally without a broker grant"],
      },
    },
  },
  {
    id: "ai-control",
    name: "AI Control Center",
    description: "Choose your AI and set what it may do.",
    icon: "AI",
    category: "system",
    status: "beta",
    component: AIControlCenter,
    keywords: ["ai", "permissions", "provider", "model", "control", "privacy", "trusted actions"],
    permissions: {
      localData: ["provider preferences", "capability manifests", "action policy", "context policy"],
      device: [],
      network: ["future provider API endpoints after configuration"],
      ai: {
        readable: ["Capability manifests", "Permission policy", "AI activity records"],
        suggestible: ["Safer permission presets", "Provider routing", "Trusted action candidates"],
        writableWithApproval: ["Change provider", "Change app permission policy"],
        trusted: ["Block forbidden actions", "Require approval for writes"],
        forbidden: ["Grant itself new permissions", "Bypass approval policy", "Hide activity from the audit log"],
      },
    },
  },
  {
    id: "sources",
    name: "Connected Sources",
    description: "Scopes, exclusions, and index status.",
    icon: "So",
    category: "system",
    status: "beta",
    component: Sources,
    keywords: ["sources", "index", "indexing", "scope", "connect", "folder", "exclusions"],
    permissions: {
      localData: ["source registry", "scope settings", "exclusions", "index state"],
      device: ["connected source scan when enabled"],
      network: ["future connected services after authorization"],
      ai: {
        readable: ["Source list", "Readable/indexable scope", "Last-indexed status"],
        suggestible: ["Suggest exclusions", "Suggest an indexing schedule"],
        writableWithApproval: ["Change a source's readable or indexable scope"],
        trusted: ["Run an index pass over an indexable source"],
        forbidden: ["Read a source you have not connected", "Index an excluded path"],
      },
    },
  },
  {
    id: "settings",
    name: "Settings",
    description: "Appearance, layout, storage, and system.",
    icon: "St",
    category: "system",
    status: "beta",
    component: Settings,
    keywords: ["settings", "preferences", "theme", "appearance", "accent", "storage"],
    permissions: {
      localData: ["theme", "accent color", "density", "provider preference", "system name"],
      device: ["system color preference"],
      network: [],
      ai: {
        readable: ["Visible settings", "App permission policy", "Storage estimate"],
        suggestible: ["Theme changes", "Accessibility improvements", "Storage cleanup options"],
        writableWithApproval: ["Apply setting changes after approval"],
        trusted: ["Apply user-selected appearance settings locally"],
        forbidden: ["Change provider, privacy, or data settings silently", "Reset or export data without explicit command"],
      },
    },
  },
  {
    id: "audit-log",
    name: "Audit Log",
    description: "Every system and AI action, on the record.",
    icon: "Au",
    category: "system",
    status: "beta",
    component: AuditLog,
    keywords: ["audit", "log", "history", "activity", "events"],
    permissions: {
      localData: ["audit events", "AI action records", "indexing events"],
      device: [],
      network: [],
      ai: {
        readable: ["Audit events", "AI context reads", "Indexing history", "Permission changes"],
        suggestible: ["Risk summaries", "Suspicious action highlights"],
        writableWithApproval: ["Create audit summaries", "Export logs"],
        trusted: ["Append local event entries from system actions"],
        forbidden: ["Edit or delete log entries", "Suppress future logging"],
      },
    },
  },
  {
    id: "cores",
    name: "System Cores",
    description: "The Core Services layer — the architecture, inspectable.",
    icon: "Co",
    category: "system",
    status: "beta",
    component: Cores,
    keywords: ["cores", "architecture", "system", "services", "layers", "directive", "kernel"],
    permissions: {
      localData: ["none — renders the static Core registry plus live counts"],
      device: [],
      network: [],
      ai: {
        readable: ["Core definitions, statuses, and routing rules"],
        suggestible: ["Explain which Core owns a behavior"],
        writableWithApproval: [],
        trusted: [],
        forbidden: ["Modify Core definitions"],
      },
    },
  },
  {
    id: "platform",
    name: "Platform",
    description: "Where Locus goes next — targets and model routing.",
    icon: "Pl",
    category: "system",
    status: "stub",
    component: Platform,
    keywords: ["platform", "desktop", "android", "server", "routing", "model", "expansion"],
    permissions: {
      localData: ["platform targets", "model routing table"],
      device: [],
      network: ["future desktop/Android/server integrations"],
      ai: {
        readable: ["Routing preferences", "Platform capabilities"],
        suggestible: ["Suggest a routing table for a workload"],
        writableWithApproval: ["Change model routing"],
        trusted: [],
        forbidden: ["Dispatch requests to an unconfigured provider", "Route sensitive data to the cloud without approval"],
      },
    },
  },
  {
    id: "dev",
    name: "Dev",
    description: "Author, validate, sandbox-run, and install generated software artifacts.",
    icon: "Dv",
    category: "system",
    status: "beta",
    component: DevApp,
    keywords: ["dev", "artifact", "widget", "generate", "sandbox", "install", "code", "diff"],
    permissions: {
      localData: ["dev.artifacts", "dev.runs"],
      device: [],
      network: [],
      ai: {
        readable: ["Artifact metadata and validation state"],
        suggestible: ["Draft artifact code changes"],
        writableWithApproval: ["Install a validated Dev artifact after approval"],
        trusted: [],
        forbidden: ["Run unvalidated code outside the sandbox", "Bypass the install gate"],
      },
    },
  },
];

const BY_ID = new Map<AppId, AppModule>(APPS.map((a) => [a.id, a]));

export function getApp(id: AppId): AppModule | undefined {
  return BY_ID.get(id);
}

export function workspaceApps(): AppModule[] {
  return APPS.filter((a) => a.category === "workspace");
}

export function systemApps(): AppModule[] {
  return APPS.filter((a) => a.category === "system");
}
