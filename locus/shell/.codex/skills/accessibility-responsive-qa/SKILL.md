---
name: accessibility-responsive-qa
description: "Use when reviewing or changing keyboard access, focus states, contrast, reduced motion, screen-reader labels, touch targets, mobile layouts, tablet flows, or print views."
---

# Accessibility and Responsive QA

## Best-Fit Repositories

- `Pal-Plant`
- `Taskalatte`
- `Era-Manifesto`
- `NL-Consultation-Form`
- `AuraNotes`
- `Factory-Town`
- `Cozyland`
- `locus-os`

## Portfolio Surface Map

- `Cozyland`, `Factory-Town`: canvas games — DOM assertions are blind, so use screenshots; keep keyboard controls and HUD behavior working.
- `NL-Consultation-Form`: tablet-first forms — check iPad viewport, print/PDF styling, and required-field error states.
- `Pal-Plant`, `Taskalatte`: ship user-facing accessibility settings (high contrast, text size, reduced motion) — exercise them plus keyboard shortcuts whenever dialogs change.
- `Era-Manifesto`: report and print views plus dark/light mode.
- `AuraNotes`: teleprompter mode legibility and contrast.
- `locus-os`: keyboard-driven command palette and focus projection behavior.

## Workflow

- Check keyboard-only navigation, visible focus, semantic labels, live regions, modals, and skip links where applicable.
- Test the smallest meaningful mobile, tablet, and desktop viewport set for the app category.
- For games, inspect screenshots because canvas/WebGL issues are not visible through DOM assertions.
- For forms and reports, include print/PDF styling and dark/light mode where the repo supports it.

## Guardrails

- Do not rely on DOM tests alone for canvas-heavy games.
- Do not hide controls behind hover-only affordances on mobile/tablet flows.
- Do not mark contrast fixed without checking disabled, hover, active, and dark-mode states.

## Validation

- Run repo browser smoke checks.
- Capture screenshots when visual layout matters.
- Record any skipped assistive-tech checks honestly.
