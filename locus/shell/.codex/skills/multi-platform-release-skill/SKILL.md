---
name: multi-platform-release-skill
description: "Use when preparing or validating Vite, PWA, Capacitor Android/iOS, Electron, Tauri, static-file, Sites, or Vercel releases across this portfolio."
---

# Multi-Platform Release Skill

## Best-Fit Repositories

- `Pal-Plant`
- `Era-Manifesto`
- `CardSpoke`
- `Taskalatte`
- `Secret-Census`
- `Astra-log`
- `locus-os`
- `faux-os-pwa`

## Portfolio Platform Matrix

- `Pal-Plant`: web + PWA + Capacitor; contacts and push notifications are native-only.
- `CardSpoke`: Vite web + `file://` local-first + Capacitor Android/iOS; run `npm run sync:android` after web builds that affect native shells.
- `Taskalatte`: web + Electron + Capacitor Android, with optional Firebase and deep links.
- `Astra-log`: web + Tauri; filesystem scopes are limited to documented temp/download paths.
- `Era-Manifesto`, `New-Gay-App-1`: web + Firebase; check authorized domains on deploy changes.
- `locus-os`: PWA shell (`faux-os-pwa` is superseded - do not treat it as current).
- `Factory-Town`, `Cozyland`, `NL-Consultation-Form`: no-build static; direct file open must keep working, and no bundling should be added.
- `Secret-Census`: web app whose `.census.json` exports feed the Godot importer - treat export compatibility as part of the release.

## Workflow

- Identify each target surface: web dev, production web, PWA install, Capacitor, Electron, Tauri, or static file.
- Run the target's canonical build/sync command rather than a generic build command.
- Keep local `.env.example`, runtime config, service worker, manifest, and native config aligned with docs.
- For mobile, verify build, sync, launch, and at least one representative flow.

## Guardrails

- Do not ship production when the user asked for preview or local-only.
- Do not mutate lockfiles or switch package managers just to get a build passing.
- Do not assume static-file apps need bundling or hosting.

## Validation

- Run production build.
- Verify platform-specific config files changed intentionally.
- Document skipped native/device testing.
