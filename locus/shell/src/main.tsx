/*
 * Entry point.
 * Boots the local-first layer (durable-record hydration + storage schema +
 * seed audit events), mounts the shell inside the appearance provider behind a
 * root error boundary, and registers the service worker so the app is
 * installable and works offline. A boot failure renders the Safe-mode recovery
 * surface (export, per-store reset, retry) instead of a blank page.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/styles/globals.css";
import { initStorage, onStorageFailure, type StorageFailure } from "@/core/storage";
import { seedIfEmpty as seedAudit } from "@/core/audit";
import { seedIfEmpty as seedObjects } from "@/core/objects";
import { seedIfEmpty as seedSources } from "@/core/sources";
import {
  seedIfEmpty as seedTrusted,
  registerExternalExecutor,
  recoverDanglingProposals,
} from "@/core/broker";
import { initDesktop } from "@/core/desktop";
import { initTimeCore, scheduleAssistantReminder, formatDateTime } from "@/core/cores/time";
import { initMonitorCore } from "@/core/cores/monitor";
import { initNotificationCore } from "@/core/cores/notification";
import { initFilesCore } from "@/core/cores/files";
import { initWebCore } from "@/core/cores/web";
import { initPeopleCore } from "@/core/cores/people";
import { initDevCore } from "@/core/cores/dev";
import { initSecretsCore } from "@/core/cores/secrets";
import { initModelRuntime } from "@/core/modelRuntime";
import { initIndexing } from "@/core/indexing";
import { seedIfEmpty as seedDevArtifacts } from "@/core/cores/dev";
import { deliver } from "@/core/cores/notification";
import { applyReducedMotion, watchReducedMotion } from "@/core/theme";
import { AppearanceProvider } from "@/core/AppearanceProvider";
import Shell from "@/components/Shell";
import { ErrorBoundary, SafeMode } from "@/components/SafeMode";

// Storage failures must reach the user — a full disk means edits stop
// persisting, which is invisible data loss on reload if nobody says so.
// Registered BEFORE any seeding/Core init so a corrupt value set aside (or a
// quota failure) during boot is surfaced, not swallowed by an empty listener
// set. One notification per failure kind per session, not one per write.
const reportedStorageFailures = new Set<string>();
function announceStorageFailure(failure: StorageFailure): void {
  if (reportedStorageFailures.has(failure.kind)) return;
  reportedStorageFailures.add(failure.kind);
  deliver({
    title:
      failure.kind === "write-failed"
        ? "Storage is full or blocked — changes are not being saved"
        : "A stored value was corrupt and has been set aside",
    detail:
      failure.kind === "write-failed"
        ? `Writing “${failure.key}” failed (${failure.message}). This session keeps working in memory; export your data (it now includes the unsaved changes) and free up space.`
        : `“${failure.key}” could not be read; the raw value was preserved under a backup key for recovery.`,
    source: "System",
    priority: "critical",
  });
}
onStorageFailure(announceStorageFailure);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");
const root = createRoot(rootEl);

async function boot(): Promise<void> {
  // Durable-record hydration first: keys localStorage lost (cleared, evicted,
  // or a quota-failed write only the IndexedDB mirror captured) are restored
  // BEFORE any seeding decides a store is "empty" and overwrites it.
  const recovered = await initStorage();
  seedObjects();
  seedSources();
  seedTrusted();
  seedAudit();
  seedDevArtifacts();
  // Fail any proposal left mid-flight by a prior interrupted session (an async
  // external effect that never got to settle), so it can't sit in limbo.
  await recoverDanglingProposals();
  initDesktop();
  // The Core Services layer: Time owns the one elected scheduler; Monitor and
  // Notification register jobs on it; Files, Web, and Dev register the
  // executors that fulfill approved external effects; People materializes
  // birthday reminders into Time; the indexer re-derives summaries for stale
  // objects.
  //
  // Time Core's scheduler runs its first tick synchronously, and that tick can
  // fire an already-due entry (e.g. a cold-boot birthday). So every onTimeFire
  // consumer and registerScheduledJob caller must be wired up BEFORE the
  // scheduler starts — initTimeCore() is therefore called last, after People
  // (birthday handler), Monitor, and Notification have registered.
  initMonitorCore();
  initNotificationCore();
  initFilesCore();
  initWebCore();
  initPeopleCore();
  initDevCore();
  initSecretsCore();
  // Registers the "model-runtime" Secrets consumer (Phase 3) — arming a
  // configured key still requires a real, approved secrets.use proposal;
  // this just wires the consumer that receives it.
  initModelRuntime();
  initIndexing();
  initTimeCore();
  // Wire the brokered assistant-reminder executor here (boot), where both Broker
  // and Time are already imported — keeps broker off Time's static import graph
  // (which runs through notification and would form a load-time cycle).
  registerExternalExecutor("time.reminder", (proposal) => {
    const label = proposal.effect.payload?.title?.trim();
    if (!label) return { status: "failed", detail: "No reminder label was provided." };
    const entry = scheduleAssistantReminder(label);
    return {
      status: "succeeded",
      resultId: entry.id,
      detail: `Reminder scheduled for ${formatDateTime(entry.at)}`,
    };
  });
  applyReducedMotion();
  watchReducedMotion();
  if (recovered.length > 0) {
    deliver({
      title: "Data recovered from the durable mirror",
      detail: `${recovered.length} store${recovered.length === 1 ? "" : "s"} restored (${recovered
        .slice(0, 4)
        .join(", ")}${recovered.length > 4 ? "…" : ""}). localStorage had lost or failed to save them.`,
      source: "System",
      priority: "high",
    });
  }

  root.render(
    <StrictMode>
      <ErrorBoundary>
        <AppearanceProvider>
          <Shell />
        </AppearanceProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

boot().catch((err) => {
  // One malformed store must not mean a blank page and no path to the data:
  // Safe mode offers export, per-store reset, and retry.
  console.error("[locus] boot failed — safe mode engaged", err);
  root.render(
    <StrictMode>
      <SafeMode error={err} onRetry={() => window.location.reload()} />
    </StrictMode>,
  );
});

// PWA: register the service worker in production builds. Kept out of dev so it
// never caches stale modules while iterating.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.warn("[locus] service worker registration failed", err);
    });
  });
}
