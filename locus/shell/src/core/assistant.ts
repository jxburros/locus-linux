/*
 * A local, rule-based assistant — plus an optional real-model front end.
 * ---------------------------------------------------------------------------
 * interpret() is the original, synchronous, honest intent parser: by default
 * no model is wired up, so a request either *reads* (answered immediately
 * from local context) or *writes* (turned into an ActionProposal the broker
 * must have you approve). It never changes data directly — that path does
 * not exist. interpret() is untouched by everything below it in this file.
 *
 * It practices what AI Core preaches: reads go through Search Core
 * (redaction + exclusions apply to every answer), writes go through
 * proposeThroughCore (AI Core → Security gate → Broker), Time answers come
 * from describeUpcoming, People answers from contactForAI/dueFollowUps — and
 * every turn carries its routing decision (suggestRoute) so "where would
 * this run" is visible even when no real model is connected.
 *
 * interpretAsync() (bottom of file) is the Phase 3 addition: when the user
 * has explicitly configured and enabled a real model runtime (core/
 * modelRuntime.ts), it dispatches there instead — and falls back to
 * interpret()'s exact rule-based behavior the moment the runtime is
 * disabled, refused, misconfigured, or unreachable. A model's reply either
 * becomes a proposal through the SAME proposeThroughCore calls the
 * rule-based branches make, or a plain answer — never a direct mutation.
 */

import { objectsOfType } from "./objects";
import { buildContextPacket, logContextRead } from "./aiContext";
import { proposeThroughCore, suggestRoute } from "./cores/ai";
import { searchAll, buildContextSnippets, safeSnippet } from "./cores/searchIndex";
import { describeUpcoming } from "./cores/time";
import { dueFollowUps, contactForAI } from "./cores/people";
import { record } from "./audit";
import {
  canDispatch,
  dispatchModelTurn,
  endpointClass,
  getModelRuntimeConfig,
  parseModelAction,
  type ParsedModelAction,
} from "./modelRuntime";
import type { AppId } from "@/types";

export interface AnswerTurn {
  kind: "answer";
  text: string;
  /** The AI Core routing decision for this turn, e.g. `local — no rule matched`. */
  via?: string;
}
export interface ProposalTurn {
  kind: "proposal";
  summary: string;
  via?: string;
  /** Enqueue the proposal in the broker; returns nothing. */
  commit: () => void;
}
export type AssistantTurn = AnswerTurn | ProposalTurn;

/** Interpret a prompt against local context. Deterministic; writes nothing
 *  until a ProposalTurn's commit() is called. The one side effect is the
 *  transparency row: each turn's routing decision lands on the audit log. */
export function interpret(prompt: string, activeApp: AppId | null): AssistantTurn {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  if (!text) {
    return { kind: "answer", text: "Ask me to find, count, or propose something." };
  }

  // AI Core's routing decision, surfaced on every turn.
  const route = suggestRoute(text);
  const via = `${route.route}${route.modelHint ? ` (${route.modelHint})` : ""} — ${route.reason}`;
  record({
    type: "ai.routed",
    summary: `AI Core routed a request → ${route.route}`,
    detail: route.reason,
  });

  // The authorized read scope for this turn: the same assembled context packet
  // the inspector shows. Direct Core read branches below re-check it, so a
  // workspace whose Time/People/Tasks tiles are hidden from AI (or whose
  // readable capabilities the user emptied) is not readable through a side
  // door the packet already closed.
  const scope = new Set(buildContextPacket(activeApp).scopedApps);
  const outOfScope = (appName: string) =>
    ({
      kind: "answer",
      text: `${appName} is not in the AI-readable scope of this workspace — unhide its tile or add it to the workspace's AI context scope to let me read it.`,
      via,
    }) satisfies AnswerTurn;

  // Write intents → proposals (must be approved), through AI Core → Broker.
  // Matched against the original text (case-insensitive) so captured titles
  // keep the user's capitalization.
  const addTask = text.match(/^(?:add|new|create)\s+(?:a\s+)?task[:\s]+(.+)/i);
  if (addTask) {
    const title = addTask[1].trim();
    const parts = taskCreateParts(title);
    return { kind: "proposal", summary: parts.summary, via, commit: parts.commit };
  }

  const addNote = text.match(/^(?:add|new|create|write)\s+(?:a\s+)?(?:note|card)[:\s]+(.+)/i);
  if (addNote) {
    const title = addNote[1].trim();
    const parts = noteCreateParts(title);
    return { kind: "proposal", summary: parts.summary, via, commit: parts.commit };
  }

  const remind = text.match(/^remind me(?:\s+to)?\s+(.+)/i);
  if (remind) {
    const label = remind[1].replace(/[?.!]$/, "").trim();
    const parts = reminderParts(label);
    return { kind: "proposal", summary: parts.summary, via, commit: parts.commit };
  }

  const summarize = text.match(/^summar(?:ize|ise)\s+(.+)/i);
  if (summarize) {
    const target = summarize[1].trim();
    // Retrieval through Search Core: exclusions and redaction apply.
    const hit = searchAll(target).objects[0]?.object;
    if (hit?.body) {
      const summary = naiveSummary(safeSnippet(hit.body, 400));
      return {
        kind: "proposal",
        summary: `Save a summary card for “${hit.title}”`,
        via,
        commit: () =>
          proposeThroughCore("cardspoke", {
            app: "cards",
            actionType: "cards.create",
            summary: `Save summary of “${hit.title}”`,
            detail: summary,
            effect: {
              kind: "create",
              objectType: "card",
              payload: { title: `Summary — ${hit.title}`, body: summary, tags: ["summary"] },
            },
          }),
      };
    }
    return {
      kind: "answer",
      text: `I couldn't find anything matching “${target}” to summarize.`,
      via,
    };
  }

  // Read intents → answered from context, through the Cores' AI views —
  // gated on the packet's scoped-app set (the same boundary the context
  // inspector displays), not answered unconditionally.
  if (/(what|anything).*(coming up|upcoming|ahead|scheduled)|upcoming/.test(lower)) {
    if (!scope.has("time") && !scope.has("tasks")) return outOfScope("Time");
    const lines = describeUpcoming(6);
    return {
      kind: "answer",
      text: lines.length
        ? `Coming up:\n${lines.map((l) => `• ${l}`).join("\n")}`
        : "Nothing is scheduled.",
      via,
    };
  }

  if (/follow.?up|out of touch|who.*(contact|reach out)/.test(lower)) {
    if (!scope.has("people")) return outOfScope("Contacts");
    const due = dueFollowUps();
    if (!due.length) return { kind: "answer", text: "No one is due for a follow-up.", via };
    const lines = due
      .slice(0, 5)
      .map((c) => `• ${contactForAI(c.id)}`)
      .join("\n");
    return {
      kind: "answer",
      text: `${due.length} contact${due.length === 1 ? "" : "s"} due for a follow-up:\n${lines}`,
      via,
    };
  }

  if (/(how many|count).*(task|todo)/.test(lower)) {
    if (!scope.has("tasks")) return outOfScope("Tasks");
    const tasks = objectsOfType("task");
    const open = tasks.filter((t) => !t.task?.done).length;
    return {
      kind: "answer",
      text: `You have ${tasks.length} tasks — ${open} open, ${tasks.length - open} done.`,
      via,
    };
  }

  const find = text.match(/^(?:find|search|show me|what.*about)\s+(.+)/i);
  if (find) {
    const q = find[1].replace(/[?.!]$/, "").trim();
    // The redaction-aware retrieval path — snippets are safe to display.
    const snippets = buildContextSnippets(q, 5);
    if (!snippets.length) return { kind: "answer", text: `Nothing local matches “${q}”.`, via };
    const lines = snippets.map((s) => `• ${s.source}${s.text ? ` — ${s.text}` : ""}`).join("\n");
    return {
      kind: "answer",
      text: `Found ${snippets.length} in your local data:\n${lines}`,
      via,
    };
  }

  if (/what can you (see|read)|context|visib/.test(lower)) {
    const packet = buildContextPacket(activeApp);
    return { kind: "answer", text: packet.userVisibilitySummary, via };
  }

  // Fallback: describe capability honestly.
  return {
    kind: "answer",
    text:
      "I'm a local rule-based assistant. Try: “add task: …”, “summarize field notes”, " +
      "“how many tasks are open”, “find local-first”, “what's coming up”, “who should I follow up with”, " +
      "or “what can you see”. Anything that changes data becomes a proposal you approve.",
    via,
  };
}

/** First one or two sentences, trimmed — a stand-in for a real summarizer. */
function naiveSummary(body: string): string {
  const clean = body.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
  return sentences || clean.slice(0, 160);
}

/* ============================================================================
 * Model-aware entry (Phase 3 / M5). interpret() above is untouched — every
 * existing rule-based branch keeps its exact behavior. interpretAsync() adds
 * an optional model-backed path in front of it: when the model runtime is
 * disabled or refuses, or its answer isn't reachable, it falls back to the
 * same interpret() call a caller would have made anyway. A parsed model
 * action becomes a ProposalTurn built from the SAME proposeThroughCore calls
 * the rule-based branches above make — extracted here as shared helpers so
 * the payload shape and actionType/app pairing can never drift between the
 * two paths.
 * ==========================================================================*/

interface ProposalParts {
  summary: string;
  commit: () => void;
}

/** Shared with the "add task:" rule-based branch above. */
function taskCreateParts(title: string, opts?: { modelProposed?: boolean }): ProposalParts {
  const summary = `${opts?.modelProposed ? "Model-proposed: " : ""}Create task “${title}”`;
  return {
    summary,
    commit: () =>
      void proposeThroughCore("cardspoke", {
        app: "tasks",
        actionType: "tasks.create",
        summary,
        detail: "Proposed by the assistant from a natural-language request.",
        effect: { kind: "create", objectType: "task", payload: { title } },
      }),
  };
}

/** Shared with the "add note/card:" rule-based branch above. */
function noteCreateParts(title: string, body?: string, opts?: { modelProposed?: boolean }): ProposalParts {
  const summary = `${opts?.modelProposed ? "Model-proposed: " : ""}Create card “${title}”`;
  return {
    summary,
    commit: () =>
      void proposeThroughCore("cardspoke", {
        app: "cards",
        actionType: "cards.create",
        summary,
        effect: { kind: "create", objectType: "card", payload: { title, body: body ?? "" } },
      }),
  };
}

/** Shared with the "remind me to" rule-based branch above. Time Core's
    reminder executor (scheduleAssistantReminder) always schedules for
    tomorrow 9:00 — a model-suggested `when` is recorded in the detail text
    honestly rather than silently ignored, since the executor cannot yet act
    on it. */
function reminderParts(label: string, when?: string, opts?: { modelProposed?: boolean }): ProposalParts {
  const summary = `${opts?.modelProposed ? "Model-proposed: " : ""}Create reminder “${label}” for tomorrow 9:00`;
  const detail = when
    ? `Approving schedules a real reminder in Time Core for tomorrow at 9:00 (reschedulable there). Requested time “${when}” is not yet wired into the scheduler.`
    : "Approving schedules a real reminder in Time Core for tomorrow at 9:00 (reschedulable there).";
  return {
    summary,
    commit: () =>
      void proposeThroughCore("time", {
        app: "time",
        actionType: "time.reminder",
        summary: `Reminder “${label}” — tomorrow 9:00`,
        detail,
        effect: {
          kind: "external",
          externalSummary: `Schedule reminder “${label}” for tomorrow 9:00`,
          readOnly: false,
          payload: { title: label },
        },
      }),
  };
}

function partsForModelAction(parsed: ParsedModelAction): ProposalParts {
  switch (parsed.action) {
    case "create_task":
      return taskCreateParts(parsed.title, { modelProposed: true });
    case "create_note":
      return noteCreateParts(parsed.title, parsed.body, { modelProposed: true });
    case "set_reminder":
      return reminderParts(parsed.text, parsed.when, { modelProposed: true });
  }
}

/** Return a turn with `via` replaced outright — used when the fallback
    reason IS the routing decision (there is no meaningful rule-based `via`
    to preserve underneath it). */
function withVia(turn: AssistantTurn, via: string): AssistantTurn {
  return { ...turn, via };
}

/** Return a turn with a reason appended after the rule-based `via` it
    already carries — used when the runtime is enabled but misconfigured, so
    the user sees both "what the rules decided" and "why the model didn't
    run". */
function withAppendedVia(turn: AssistantTurn, reason: string): AssistantTurn {
  const via = turn.via ? `${turn.via} — model runtime: ${reason}` : `model runtime: ${reason}`;
  return { ...turn, via };
}

/**
 * The model-aware entry point. Reads through the same AIContextPacket
 * interpret() itself consults for scope, but here the packet is what
 * actually leaves the device as the dispatched system prompt — so it is
 * logged as a genuine context read (logContextRead) at the point it is
 * consumed, mirroring how the context inspector logs a real read.
 */
export async function interpretAsync(prompt: string, activeApp: AppId | null): Promise<AssistantTurn> {
  const config = getModelRuntimeConfig();
  if (!config.enabled) {
    // Simply disabled: no model was ever going to run — nothing to explain.
    return interpret(prompt, activeApp);
  }

  const gate = canDispatch();
  if (!gate.ok) {
    // Enabled but currently refused (bad config, missing ack, provider off):
    // the user should see why, appended to the normal rule-based via.
    return withAppendedVia(interpret(prompt, activeApp), gate.reason);
  }

  const route = suggestRoute(prompt);
  if (route.route === "local" && endpointClass(config.endpointUrl) === "remote") {
    return withVia(interpret(prompt, activeApp), "routing rule requires local; endpoint is remote");
  }

  const packet = buildContextPacket(activeApp);
  logContextRead(packet);
  const result = await dispatchModelTurn({ prompt, packet, modelOverride: route.modelHint });
  if (!result.ok) {
    return withVia(interpret(prompt, activeApp), `model unreachable (${result.reason}) — local rules`);
  }

  const via = `model ${result.model} @ ${result.endpointHost} (${result.durationMs}ms)`;
  const parsedAction = parseModelAction(result.text);
  if (parsedAction) {
    const parts = partsForModelAction(parsedAction);
    return { kind: "proposal", summary: parts.summary, via, commit: parts.commit };
  }
  return { kind: "answer", text: result.text, via };
}
