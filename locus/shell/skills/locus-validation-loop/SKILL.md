---
name: locus-validation-loop
description: Run the right validation for a Locus OS change and report it honestly. Use before finishing any code change in this repo — it defines which checks apply per change type, the Core test conventions, how to verify PWA/service-worker behavior, and what to record in CHANGELOG.md.
---

# Locus Validation Loop

Validation claims in this repo are governance: `CHANGELOG.md` entries record what ran, and the manifesto forbids claiming validation that didn't happen. This skill tells you what "relevant validation" concretely means per change type.

## The commands

```bash
npm install          # once per fresh checkout
npm run typecheck    # tsc -b --noEmit
npm test             # vitest run — Core Services suites (src/**/*.test.ts, jsdom)
npm run test:watch   # re-run on change while developing
npm run build        # tsc -b && vite build  (production bundle to dist/)
npm run preview      # serve the production build — the ONLY way to see sw.js behavior
npm run dev          # dev server (no service worker)
```

## What to run, per change type

| Change | Required | Also recommended |
|---|---|---|
| Any TypeScript change | `typecheck` | — |
| Core Services layer (`src/core/cores/*`) | `typecheck` + `npm test`; extend/add the core's co-located test file | — |
| Core infrastructure (`storage.ts`, `broker.ts`, `objects.ts`, `audit.ts`, `permissions.ts`, `desktop.ts`) | `typecheck` + `npm test` (regressions ripple into core suites) | Extend the existing infrastructure suites for changed behavior |
| App/component/UI | `typecheck` + manual browser smoke of the changed surface (dev server is fine) | `npm test` (cheap) |
| Shell, tiles, workspace, Focus, header | `typecheck` + manual smoke: dashboard → place/resize a tile → Focus in/out → Settings; check dark + light | `build` for broad changes |
| PWA, service worker, manifest, icons, Vite config, deploy | `build` + `preview` and verify in the served production build (SW registers only in PROD) | Bump/verify the SW cache name if precached assets changed |
| Broker / security / permissions / secrets behavior | `typecheck` + `npm test` + a manual end-to-end pass: assistant → propose → inspect gate metadata (risk, undo note) → approve → execute → verify audit chain; **and the negative path** (e.g. empty an app's write tiers in AI Control Center → proposal refused, refusal audited, nothing created) | Playwright smoke against `preview` (pattern used in the 2026-07-04 stabilization pass) |
| Docs/skills only | none required | — |

## Core test conventions

- Tests live beside their Core: `src/core/cores/<core>.test.ts` (14 suites exist today).
- They run against **real** `src/core/storage.ts` via jsdom's `localStorage` — not a mocked persistence layer — so they exercise the same path the browser runs. Follow that pattern; don't introduce a storage mock.
- Vitest config: `vitest.config.ts` (jsdom, `restoreMocks: true`, `@` → `src`). Reset persisted state between tests the way neighboring suites do rather than inventing a new fixture style.
- Every Core should have a regression suite covering its owned behavior; if you add Core behavior without a test, record that gap in the changelog instead of staying silent.

## Known validation gaps (be honest about them)

- This imported package has no active GitHub Actions validation workflow. Use `make -C locus shell-check` and `make -C locus shell-e2e` from the repository root. Existing repository dependency scanning is not a substitute for these checks.
- Broad app/component/layout coverage remains incomplete. The imported e2e suite covers Dev widgets/sandbox, multi-tab persistence, and offline PWA launch; other UI correctness still needs manual smoke.
- Multi-tab behaviors (scheduler/indexer election, cross-tab storage events) need two real tabs to verify; jsdom cannot.

## Reporting

In the `CHANGELOG.md` entry (format in `skills/spec-driven-development/SKILL.md`), the Notes section must state exactly which of the above ran, which were skipped and why, and what was manually verified (which flows, which browser context, dev vs preview). "Validation: typecheck + core tests; manual smoke skipped because the change is doc-only" is a good entry. "Everything works" is not.
