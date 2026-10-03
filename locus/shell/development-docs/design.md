# Locus OS UX/UI & Aesthetic Design Specification

**Status:** Working draft  
**Scope:** Front-end user experience, visual design, spatial interaction, and shipped app surface behavior  
**Out of scope for this draft:** Backend architecture, Core implementation details, launch messaging, marketing copy, and final consumer-facing release notes

---

## 1. Purpose

This document defines how Locus OS should look, feel, move, and be interacted with across the Dashboard, workspaces, tiles, Focus mode, Freeform mode, overlays, system surfaces, and shipped apps.

The goal is not to make Locus look like an existing desktop OS, mobile launcher, web dashboard, or productivity suite. The goal is to preserve and sharpen Locus's own interface identity: a spatial, local-first, grid-based personal operating surface.

Every visible feature should feel like part of the same environment.

---

## 2. Design thesis

Locus should feel like a precise personal operating surface: calm, spatial, technical, user-owned, and legible.

It should feel closer to:

- A drafting table.
- A modular instrument panel.
- A personal control room.
- A quiet writing and thinking environment.
- A tile-based OS surface built around place and continuity.

It should not feel like:

- A rounded SaaS dashboard.
- A clone of Windows, macOS, Android, ChromeOS, or iOS.
- A web app with a sidebar and pages.
- A pile of overlapping floating windows.
- A phone launcher scaled up to desktop.
- A playful app grid with decorative branding.

The design direction is:

> Severe, but not cold. Technical, but not confusing. Sparse, but not empty. Precise, but not brittle.

---

## 3. Core principles

### 3.1 Clarity without softness

The interface should become easier to read and operate without becoming rounder, more colorful, or more conventional.

Do not solve clarity problems by adding rounded cards, colorful app brands, heavy shadows, or friendly decoration. Solve them with hierarchy, spacing, state, motion, and better affordances.

### 3.2 Spatial continuity

The user should understand where things live.

Tiles should move, resize, compress, focus, and return in ways that preserve spatial context. Focus should feel like zooming into a placed surface, not navigating to a separate page. Leaving Focus should restore the user's sense of place.

### 3.3 Visible manipulability

Locus is directly manipulated. Users drag, resize, focus, place, and rearrange surfaces.

Important interactions should be discoverable. The UI can remain quiet, but it must not hide the fact that tiles are movable, resizable, focusable, and placeable.

### 3.4 One system, not many app brands

Apps may have different purposes, but they should not have independent visual identities. App surfaces should use the same type, color, spacing, controls, list behavior, active states, and motion vocabulary.

### 3.5 Monochrome first, accent second

Neutral surfaces and typography carry the design. Accent color is a system signal, not decoration.

### 3.6 Calm density

Locus may be information-dense, but it should not feel noisy. Density should come from structured rows, tile compression, and efficient typography rather than cramped spacing or visual clutter.

### 3.7 Honest state

The interface should clearly distinguish normal, selected, focused, temporary, saved, local, paused, disabled, destructive, and pending states.

---

## 4. Visual identity

### 4.1 Aesthetic keywords

Locus is:

- Monochrome-first.
- Grid-based.
- Straight-edged.
- Hairline.
- Sparse.
- Technical.
- Typographic.
- Spatial.
- Precise.
- Low-decoration.
- Calmly dense.

### 4.2 Non-negotiable visual rules

All UI should follow these rules unless a specific exception is documented:

1. Use one accent color at a time.
2. Use neutral surfaces first.
3. Use square corners.
4. Use 1px borders as the primary separator.
5. Avoid decorative shadows except for overlays.
6. Avoid decorative gradients.
7. Use typography and layout to create hierarchy.
8. Use monospace for system facts.
9. Do not give apps their own brand colors.
10. Do not introduce rounded card UI.
11. Do not introduce new font families.
12. Do not use page-level scrolling for the OS shell.

---

## 5. Color system

### 5.1 Color roles

Use semantic color tokens, not raw colors, for interface work.

Core semantic roles:

```css
--bg
--bg-sunken
--surface
--surface-2
--surface-3
--border
--border-strong
--text
--text-2
--text-3
--accent
--accent-ink
--scrim
```

### 5.2 Theme behavior

Dark and light mode should feel like the same product, not two separate designs. Light mode is an inversion of the same neutral system; it should not become softer, brighter, or more decorative.

### 5.3 Accent usage

Use accent for:

- Active selection.
- Current tab.
- Primary local action.
- Focused or selected tile state.
- Placement guides.
- Important glyphs.
- Live status.
- Thin emphasis borders.
- Approved or successful status.

Do not use accent for:

- App backgrounds.
- Large decorative fills.
- Per-app identity.
- Random icons.
- Long paragraphs.
- Every button on the screen.

### 5.4 Warning and danger

Use crimson for destructive or high-risk actions. Use amber for caution or warning states.

Destructive controls should not use the normal accent hover treatment. Delete, erase, reset, revoke, and remove actions should use danger styling when they are visible as destructive actions.

---

## 6. Typography

### 6.1 Font roles

Locus has two voices:

**UI voice**  
Used for normal interface text, labels, settings, controls, app content, and prose.

**System voice**  
Used for machine-like facts, operational state, and compact identity marks.

### 6.2 Use monospace for system facts

Use monospace for:

- Time.
- Dates.
- Counts.
- IDs.
- Keyboard shortcuts.
- Status badges.
- App glyphs.
- Tile glyphs.
- Storage amounts.
- Permission or capability labels.
- Technical metadata.
- Compact state labels.

### 6.3 Uppercase

Uppercase is appropriate for:

- Eyebrow labels.
- Status badges.
- Small system labels.
- Mode labels.
- Capability labels.
- Compact operational state.

Do not uppercase normal paragraphs, descriptions, form labels, or standard action buttons unless the control is a compact system control.

### 6.4 Type hierarchy

Recommended hierarchy:

- Large facts: clock, stopwatch, major counts.
- App title or focused surface title.
- Section heading / eyebrow.
- Row title.
- Body text.
- Metadata / hint.
- Disabled / faint state.

Hierarchy should come from size, weight, color, and placement. Avoid adding decorative containers just to create hierarchy.

---

## 7. Surface hierarchy

The current visual language is strong but can become flat if every element uses the same surface, border, and text weight. Use a consistent surface hierarchy.

### 7.1 Level 0: Workspace background

The quietest layer. This is the negative space behind tiles. Empty space should feel intentional.

### 7.2 Level 1: Normal tile or panel

Default surface with a hairline border.

Use for:

- Normal placed tiles.
- Standard app panels.
- List containers.
- Neutral grouped controls.

### 7.3 Level 2: Active, selected, or live surface

A Level 1 surface with stronger state.

Use:

- Accent border.
- Stronger border.
- Subtle header emphasis.
- Thin accent rule.

Do not use large accent fills except for active segmented controls or primary buttons.

### 7.4 Level 3: Focused app or overlay

The highest normal working surface.

Use for:

- Focused app tile.
- Command palette.
- Dialog panels.
- Context menus.

Overlays may use shadow. Normal tiles and app panels should not.

---

## 8. Spatial layout model

### 8.1 The operating surface

The Locus shell is not a scrolling webpage. The workspace is a fixed, spatial surface. App content may scroll inside focused app areas or tile bodies, but the OS shell itself should not behave like a page.

### 8.2 Grid behavior

The user should feel that everything sits on a precise invisible grid.

Tiles may feel flexible and nearly freeform, but they should snap, align, share borders, and preserve spatial order.

### 8.3 Empty space

Empty space is allowed and should feel intentional. It is not automatically a layout bug.

Use empty space to create focus, separation, and user-defined structure. Do not fill every gap unless the user chooses to shuffle, pack, or place more tiles.

---

## 9. Tile system

### 9.1 Tile personality

Tiles are the basic operating unit of Locus.

A tile should feel like:

- A placed object.
- A live surface.
- A resizeable unit.
- Part of a shared grid.
- Calm until interacted with.

A tile should not feel like:

- A floating card.
- A traditional desktop window.
- A draggable web widget from another product.
- A branded app bubble.

### 9.2 Tile frame

Tile frames should remain minimal:

- Neutral surface.
- 1px border.
- Square corners.
- Small header.
- Compact app or system glyph.
- Compact label.
- Quiet controls.
- No heavy chrome.

### 9.3 Tile states

All tiles should support clear visual states.

#### Default

Neutral surface and hairline border.

#### Hover

Border strengthens slightly. Optional controls may reveal.

#### Selected

Accent border or accent edge. Selected state should be more visible than hover.

#### Dragging

The original tile remains visible but de-emphasized while manipulation is active.

#### Focused

The tile becomes the app surface. Its border and header should make the transition clear.

#### Sleeping / paused / low-power

Content is visually de-emphasized. The state should be visible without looking broken.

#### Widget

Persistent edge widgets should feel sunken into the OS surface rather than like normal app tiles.

### 9.4 Tile content compression

Every tile should survive being resized.

Tile content should degrade through these modes:

1. **Full** — rich content.
2. **Compact** — reduced content.
3. **Mini** — tiny content.
4. **Icon** — glyph only.

Do not assume a tile always has enough room for full app content. Every tile-eligible surface needs a compact identity.

### 9.5 Tile controls

Tile controls should be quiet but discoverable.

Common controls:

- Focus.
- Options.
- Resize.
- Drag.
- Back, when focused.

Controls may appear on hover, selection, keyboard focus, or touch activation.

### 9.6 Improved affordance requirements

To improve discoverability, selected or hovered tiles should reveal enough of their manipulability to teach interaction.

Recommended affordances:

- A faint resize corner bracket on hover or selection.
- Stronger edge feedback when the pointer approaches a resize edge.
- A visible drag zone or drag cursor on the tile header.
- Touch-visible controls after selection or long press.
- A one-time first-run hint showing drag, resize, and Focus.

The design should not show every control all the time, but it should not make core interactions invisible.

---

## 10. Header system

### 10.1 Header as spatial chrome

The header is not a conventional fixed web app bar. It is part of the spatial OS and should continue to feel like a persistent edge tile or edge band.

### 10.2 Default header grouping

The default header layout should be grouped into zones.

#### Left zone: place and navigation

Recommended items:

- Locus logo / system name.
- Dashboard / Focus switcher.
- Workspace name.
- Freeform state.

#### Center or flexible zone: current context

Recommended items:

- Current mode.
- Saved / temporary state.
- Active Focus origin.
- Search or command hint.

#### Right zone: system utilities

Recommended items:

- AI.
- Notifications.
- Battery.
- Clock.
- Apps.
- Settings.

The header can remain customizable, but the default layout should teach the OS structure before the user changes it.

### 10.3 Header visual style

Header items should be:

- Compact.
- Typographic.
- Rectangular.
- Mostly neutral.
- Monospace for system facts.
- Accent only for active or important state.

Avoid large icons, pill controls, app colors, and decorative separators.

### 10.4 Freeform header state

Freeform must be unmistakable.

When Freeform is active, the header should clearly communicate that layout changes are temporary until applied or saved.

Recommended pattern:

```text
FREEFORM — temporary layout
[Save as Workspace] [Apply] [Discard]
```

The styling should be compact and native to the header, not a large warning banner.

---

## 11. Focus mode

### 11.1 Focus identity

Focus is one of the signature interactions of Locus. It should feel like the user is expanding a placed surface, not opening a separate app page.

### 11.2 Focus header pattern

Every focused app surface should have a consistent header pattern:

```text
‹ Back    App name                         origin / context
```

Examples:

```text
‹ Back    Writer                           placed on Dashboard
‹ Back    Tasks                            from Scratchpad
‹ Back    Files                            placed on Work workspace
```

The focused header should be stronger and clearer than a normal tile header, but it should not become a traditional app title bar.

### 11.3 Focus transition

Entering and leaving Focus should preserve spatial memory.

- The tile grows from its current position.
- Surrounding tiles compress or de-emphasize.
- Leaving Focus restores the prior spatial relationship.
- The user should feel that the focused app still belongs to the workspace.

### 11.4 Focus spacing

Focused apps should receive enough internal spacing to feel like usable work surfaces. They should not feel like oversized tile previews.

Use consistent focused app padding, row rhythm, and toolbar placement.

---

## 12. Freeform mode

### 12.1 Freeform purpose

Freeform is layout-editing mode. It is where users experiment with placement, arrangement, and workspaces.

### 12.2 Freeform state

The user should always know:

- They are in Freeform.
- Changes are temporary.
- They can save as a Workspace.
- They can apply changes.
- They can discard changes.
- They can move items to the Scratchpad.

### 12.3 Freeform visual treatment

Freeform should use a clear but restrained system treatment:

- Header state label.
- Temporary-state indicator.
- Compact action cluster.
- Optional workspace outline or subtle surface cue.

Avoid large banners or modal interruption during normal Freeform editing.

---

## 13. Apps surface and placement

### 13.1 Apps surface role

The Apps surface is not a phone launcher. It is where surfaces, widgets, and anchors enter the spatial workspace.

The user should understand that apps and widgets can be:

- Opened.
- Focused.
- Placed.
- Dragged into the workspace.
- Added more than once where allowed.

### 13.2 Apps surface visual behavior

Apps and widgets should appear in compact rows or grids that emphasize placement and use, not brand identity.

Use:

- Monospace app marks.
- Short names.
- Compact descriptions where space allows.
- `+ place` style placement actions.
- Drag affordances.

Avoid:

- Large colorful app icons.
- App-store style cards.
- Marketing descriptions.
- Independent app branding.

---

## 14. Scratchpad

### 14.1 Scratchpad role

Scratchpad is a holding area, not a taskbar and not minimized windows.

It should communicate:

- This surface exists but is not currently placed.
- It can be reopened or promoted back into the workspace.
- It is intentionally held aside.

### 14.2 Scratchpad visual behavior

Scratchpad items should feel like small held tiles:

- Rectangular.
- Bordered.
- Compact.
- Glyph plus name.
- Optional pin state.
- Clear actions for open, promote, pin, and remove.

---

## 15. Core components

### 15.1 Buttons

Buttons should use the shared button language.

Common forms:

- Default button.
- Primary button.
- Ghost button.
- Small button.
- Icon button.

Rules:

- Use one primary action per immediate context.
- Use ghost buttons for secondary local actions.
- Use danger styling for destructive actions.
- Preserve accessible tap targets where practical.
- Avoid app-specific button variants.

### 15.2 Fields

Fields should be rectangular, bordered, and sunken.

Rules:

- Use shared field styling.
- Use muted placeholder text.
- Use accent for focus state.
- Use full width unless the field has a compact purpose.
- Do not create rounded search boxes or pill inputs.

### 15.3 Segmented controls

Segmented controls are appropriate for modes of equal weight.

Use for:

- Write / Preview.
- Ask / Context / Approvals / Memory.
- Theme choices.
- Density choices.
- Filters where all options are peers.

Visual rules:

- One rectangular outer border.
- Internal 1px dividers.
- Active segment uses accent fill and accent ink.
- Inactive segments use muted text.

### 15.4 Toolbars

Toolbars should be compact rows of local controls.

Use for:

- Filters.
- View modes.
- Local actions.
- Counts.
- Export/delete actions.

Toolbars should wrap when needed and should not become oversized app headers.

### 15.5 Lists and rows

Lists should be structured with hairline row dividers.

Common row structure:

```text
[glyph/control] [primary label] [metadata/status] [actions]
```

Rules:

- Use accent left border for active row.
- Use monospace for compact metadata.
- Keep destructive actions visually distinct.
- Use truncation rather than layout breakage.
- Keep row heights consistent within each surface type.

### 15.6 Chips and badges

Use chips and badges for compact metadata and status.

Use for:

- Tags.
- Project names.
- Status.
- App state.
- Counts.
- Capabilities.
- Local / temporary / approval-required states.

Rules:

- Rectangular.
- Hairline border.
- Small text.
- Often monospace.
- No rounded pills.

### 15.7 Panels

Panels should be neutral and bordered. They should not look like rounded SaaS cards.

Use panels to group controls or content only when the grouping improves legibility.

### 15.8 Empty states

Empty states should remain plain and functional.

This draft does not define final user-facing empty-state language. Visually, empty states should be:

- Quiet.
- Centered or placed in the relevant content area.
- Bordered or dashed only when useful.
- Actionable if there is an obvious next step.

### 15.9 Planned states

Planned or incomplete surfaces may use a consistent planned-state component, but this draft does not define final user-facing planned-state language.

Visually, planned states should be:

- Clearly marked.
- Compact.
- Honest.
- Visually distinct from functioning controls.

---

## 16. Overlays

### 16.1 Command palette

The command palette should feel like the fastest way to move through the OS.

It should be:

- Keyboard-first.
- Centered.
- Search-first.
- Typographic.
- Low-decoration.
- System-level.

Visual rules:

- Scrim behind panel.
- Rectangular panel.
- Strong border.
- Optional overlay shadow.
- Input row at top.
- Grouped results.
- Active row highlight.
- Monospace icons and hints.

### 16.2 Dialogs

Dialogs should use:

- Scrim.
- Centered panel.
- Strong 1px border.
- Neutral surface.
- Square corners.
- Internal scroll when needed.
- Clear action row.

Dialogs should not feel imported from another design system.

### 16.3 Context menus

Context menus should be compact and rectangular.

Use:

- Optional title.
- Menu rows.
- Separators.
- Danger treatment for destructive rows.
- Small hints where needed.

Do not use rounded menu bubbles.

---

## 17. Glyph and icon system

### 17.1 Direction

Locus should use a compact glyph system rather than colorful app icons.

Glyphs should feel like labels on an instrument panel, not app-store branding.

### 17.2 Glyph taxonomy

Recommended taxonomy:

#### Workspace apps

Use two-letter monospace marks where appropriate.

Examples:

```text
Wr  Ca  Ta  Pr  Fi
```

#### System apps

Use uppercase technical abbreviations or geometric marks.

Examples:

```text
AI  St  Au  Co  Pl
```

#### Live widgets

Use geometric symbols.

Examples:

```text
◔  ◎  ◐  ◍  ◈
```

#### Object types

Use small object glyphs.

Examples:

```text
≡  document
▢  card
☑  task
◈  project
▚  file
◌  memory
```

### 17.3 Glyph rules

- Glyphs should work in monospace.
- Glyphs should remain recognizable in icon-mode tiles.
- Do not mix emoji-style colorful icons with system glyphs.
- Do not use large illustrative icons for app identity.
- Keep glyph usage consistent between tiles, launcher, command palette, and object rows.

---

## 18. Motion

### 18.1 Motion personality

Motion should be:

- Subtle.
- Fast.
- Spatial.
- Purposeful.
- Reversible.
- Respectful of reduced motion.

Motion should explain where things came from and where they went.

### 18.2 Use motion for

- Tile move.
- Tile resize.
- Focus transition.
- Tile enter and exit.
- Placement preview.
- Saved feedback.
- Overlay appearance.
- Hover and active state transitions.

### 18.3 Avoid motion for

- Decorative looping animation.
- Attention-grabbing background movement.
- Bouncy or playful effects.
- Slow page transitions.
- App-specific animation styles.

### 18.4 Reduced motion

All motion must respect reduced-motion settings. Reduced motion should remove non-essential animation while preserving necessary state changes.

---

## 19. Saved, temporary, and local state

### 19.1 Saved state

When Dashboard or Workspace changes are saved automatically, the UI should provide subtle confirmation.

Recommended treatment:

- Small header status.
- Brief fade-in text.
- Monospace `SAVED` or equivalent state mark.
- No toast unless the change is significant.

### 19.2 Temporary state

Temporary layout state should be visible in Freeform.

Recommended treatment:

- Header state label.
- Compact action cluster.
- Distinct but restrained temporary indicator.

### 19.3 Local state

Local-first state should appear where it affects trust or user understanding.

Recommended visual marks:

```text
LOCAL
ON THIS DEVICE
APPROVAL REQUIRED
NOT CONNECTED
```

Use compact monospace chips or badges. Do not turn these into marketing slogans.

---

## 20. Responsive and touch behavior

### 20.1 Compression first

Locus should respond by compression before reflow.

Priority order:

1. Preserve spatial identity.
2. Compress tile content.
3. Switch tile presentation mode.
4. Use stacked layout on narrow screens.
5. Allow internal scrolling inside sanctioned containers.

### 20.2 Narrow screens

On narrow screens:

- Split panes collapse to one column.
- Lists may move above detail panes.
- Side panels become lower sections.
- Tile controls should become more visible for touch.
- The workspace may use stacked mode.

### 20.3 Touch-specific requirements

Touch should not rely on hover.

Touch mode should include:

- Larger active controls.
- Long-press menu access.
- Visible selected-tile controls.
- Clear edit-layout entry point.
- Larger resize affordances.
- Tap alternatives to drag-only interactions where practical.

### 20.4 Mobile bottom shelf

On phone-width layouts, a bottom shelf may carry essential navigation and surface access.

Recommended items:

- Dashboard.
- Focus.
- Apps.
- Settings.
- Current workspace or mode.

The shelf should remain compact and rectangular.

---

## 21. Accessibility and usability

### 21.1 Required behavior

All visible UI must support:

- Keyboard access.
- Visible focus states.
- Screen-reader labels for icon-only controls.
- Sufficient tap targets where practical.
- No reliance on color alone.
- Reduced motion.
- Light and dark themes.
- Text truncation instead of layout breakage.
- Internal scrolling where content exceeds its area.

### 21.2 Keyboard behavior

Common expectations:

- Escape closes overlays or exits temporary modes where appropriate.
- Enter commits obvious form actions.
- Arrow keys navigate command/list surfaces where implemented.
- Focus outlines remain visible.
- Icon-only controls include accessible labels.

### 21.3 Color-independent state

State should not be expressed through color alone.

Use combinations of:

- Text labels.
- Borders.
- Icons or glyphs.
- Position.
- Shape.
- Badges.
- Motion.

---

## 22. Polishing priorities

The design should be improved by making the existing identity clearer and more intentional.

Priority improvements:

1. Add a formal Focus header pattern.
2. Group the default header into navigation, context, and system zones.
3. Improve selected-tile and hover affordances for drag, resize, and Focus.
4. Make Freeform mode unmistakable but not loud.
5. Normalize destructive-action styling with danger treatment.
6. Normalize spacing, row rhythm, and focused-app padding.
7. Clean up typography token usage and avoid fallback type sizes where tokens already exist.
8. Formalize the glyph taxonomy.
9. Make saved, temporary, and local states more visible.
10. Treat touch/mobile as a first-class interaction mode, not only a responsive fallback.

---

## 23. Do and don't

### Do

- Use the existing token system.
- Preserve the monochrome-first aesthetic.
- Use accent sparingly.
- Use square corners.
- Use hairline dividers.
- Make active state clear.
- Make manipulability discoverable.
- Preserve spatial continuity.
- Use monospace for system facts.
- Use internal scroll regions.
- Keep overlays rectangular and direct.

### Don't

- Add rounded cards.
- Add per-app color palettes.
- Add colorful app icons.
- Add gradient backgrounds.
- Add heavy shadows to normal surfaces.
- Add floating window chrome.
- Add app-specific navigation models.
- Hide core interactions behind hover only.
- Use normal accent styling for destructive actions.
- Introduce page-level scrolling for the OS shell.

---

## 24. UX/UI review checklist

A front-end change passes design review when:

1. It uses semantic tokens.
2. It works in dark and light mode.
3. It respects density settings.
4. It uses square corners.
5. It uses one accent color.
6. It uses hairline borders.
7. It has visible focus states.
8. It works with keyboard.
9. It works on touch or has a touch-safe alternative.
10. It has clear hover, selected, disabled, and active states where relevant.
11. It handles narrow screens.
12. It handles tile compression if tile-eligible.
13. It does not introduce app-specific branding.
14. It does not introduce rounded SaaS-card UI.
15. It preserves spatial continuity.
16. It makes destructive actions visually distinct.
17. It makes temporary state visible when changes are not final.
18. It feels like part of Locus rather than a separate embedded app.

---

## 25. Current design direction in one sentence

Locus should become a precise, spatial, monochrome personal OS with the clarity of a professional instrument panel and the calm of a writing environment.
