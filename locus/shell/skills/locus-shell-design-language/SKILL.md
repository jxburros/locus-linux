---
name: locus-shell-design-language
description: Apply the Locus OS design language and spatial-shell invariants correctly. Use when creating or changing any UI — app surfaces, tiles, shell chrome, header, Focus, dialogs, CSS/tokens, typography, color, motion — or when reviewing UI work for design conformance.
---

# Locus Shell Design Language

The full specification is `development-docs/design.md` (~1,100 lines). Do not restyle by taste and do not read the whole spec for every task — this skill gives the hard rules that are never optional, then points you at the right section for depth.

## Hard rules (violating any of these is a defect)

1. **Monochrome first, one accent.** The UI is grayscale; exactly one accent color exists (user-configurable) and is spent only on the current point of attention or interaction. Warning/danger colors are reserved for real warnings/danger, never decoration.
2. **Zero radius, hairline borders.** Straight lines everywhere. No rounded cards, no drop-shadow "elevation" language — surface hierarchy comes from background level and border treatment (design.md §7).
3. **Monospace is the system voice.** Every machine fact — timestamps, ids, counts, capability tiers, storage keys, audit rows — renders in monospace so data reads differently from prose (§6.2). Prose and labels use the UI face; labels are often uppercase micro-type (§6.3).
4. **The surface is fixed and spatial, never scrolling.** The workspace does not scroll; tiles compress through presentation modes (full → compact → mini → icon) instead of overflowing (§8, §9.4). Content *inside* an app tile may scroll; the operating surface may not.
5. **Focus is a projection, not navigation.** Focusing grows the tile in place while the rest compress around it, and leaving Focus restores the arrangement (§11). Never implement Focus-like behavior as a route change or a modal takeover.
6. **The header is made of tiles.** Header edge segments are user-editable; the five required controls (logo→Dashboard, Dashboard↔Focus switcher, Freeform, Apps, Settings) must always survive somewhere (§10). Never hard-code new fixed chrome outside the header-item system.
7. **Touching tiles share one hairline border**; empty space exists only where the user made it (§8.3, §9.2).
8. **Honest state.** Planned/stub behavior is labeled (the `PLANNED` callout / `FutureNote` pattern); never style a scaffold to look functional (§3.7).
9. **Accessibility floor:** visible focus states, full keyboard navigation, 44px minimum tap targets, labels on controls, no meaning carried by color alone, respect `prefers-reduced-motion` and `prefers-color-scheme`. (The `accessibility-responsive-qa` skill covers the audit workflow.)

## Where the system is implemented

- Design tokens: `src/styles/tokens.css` (all theming is CSS custom properties; theme/accent/density changes are attribute flips on `<html>` via `src/core/AppearanceProvider.tsx`). Never hard-code colors, spacing, or fonts in component CSS when a token exists.
- Global reset + shared atoms: `src/styles/globals.css`; shared primitives (`Section`, `FutureNote`, …) in `src/components/ui.tsx` — use these in app surfaces so apps read as one system, not many brands (§3.4).
- Tile chrome and states: `src/components/desktop/TileFrame.tsx` (presentation modes), tile behavior/geometry in `src/core/tileMeta.ts`, `src/core/surface.ts`, `src/core/snap.ts`, `src/core/focusLayout.ts`.
- Per-app styles are co-located `.css` files that should mostly consume tokens and atoms.

## Section index for deeper work

| Task | Read design.md |
|---|---|
| Any visual decision, choosing "the Locus look" | §2 Design thesis, §4 Visual identity (incl. §4.2 non-negotiable rules) |
| Color, theme, accent, warning/danger | §5 |
| Typography, monospace usage, uppercase, hierarchy | §6 |
| Panels, elevation, active/selected/overlay treatment | §7 Surface hierarchy |
| Workspace, grid, empty space | §8 Spatial layout model |
| Tiles: frame, states, compression, controls, affordances | §9 |
| Header segments, zones, freeform header state | §10 |
| Focus mode identity, header pattern, transition | §11 |

## Working rules

- New UI must work in dark **and** light themes and at every density before it is done; verify by flipping Settings → Appearance, not by assumption.
- Motion is for spatial continuity (elements transitioning between rects), not decoration; every animation needs a reduced-motion fallback.
- When a design need seems to conflict with these rules, the rules win unless `development-docs/design.md` is deliberately amended — flag the conflict instead of quietly deviating.
- Design conformance is part of validation: smoke the changed surface in the browser (dashboard, Focus, and the compressed tile modes if a tile is affected) and note in `CHANGELOG.md` what was visually verified.
