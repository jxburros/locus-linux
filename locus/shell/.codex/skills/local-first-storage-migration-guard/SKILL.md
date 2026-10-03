---
name: local-first-storage-migration-guard
description: "Use when changing localStorage, IndexedDB, SQLite, import/export, backup/restore, offline-first sync, schema migration, quota handling, or data recovery behavior."
---

# Local-First Storage and Migration Guard

## Best-Fit Repositories

- `locus-os`
- `Pal-Plant`
- `CardSpoke`
- `Secret-Census`
- `Taskalatte`
- `AI-Server-Studio`
- `AI-model-test`
- `AuraNotes`
- `NL-Consultation-Form`

## Portfolio Storage Map

- localStorage: `Factory-Town` (save key `factoryTownSave`), `NL-Consultation-Form` (records plus media attachments), `Taskalatte` (local persistence with optional Firebase sync).
- IndexedDB: `Secret-Census` (versioned migrations), `Blobsmith`.
- SQLite: `AI-model-test` (additive schema changes only, via the schema owner), `AI-Server-Studio` (backend-owned; frontend goes through APIs).
- Shared storage core: `locus-os` - apps must route persistence through `src/core/storage.ts` and the shared object model, not write localStorage directly.
- Capacitor storage: `CardSpoke`, `Pal-Plant` - web and native persistence semantics differ; do not assume parity.
- Session-only by design: `AuraNotes` local audio blob URLs are not persisted.

## Workflow

- Identify the storage owner module and all import/export paths before editing.
- Map current schema versioning, migration flags, backup files, and corruption/quota handling.
- Preserve user data by adding forward-compatible fields and neutral defaults; avoid destructive migrations.
- Test fresh install, existing data upgrade, export/import round trip, corrupt data, and storage unavailable paths when relevant.

## Guardrails

- Do not rename or remove persisted fields without an explicit migration strategy.
- Do not put secrets, API keys, tokens, or provider credentials into exports, logs, SQLite rows, or markdown reports.
- Do not assume cloud sync is authoritative unless the repo explicitly says so.

## Validation

- Run storage unit tests or smoke scripts.
- Perform a backup/export/import round trip where supported.
- Check that optional cloud sync remains optional.
