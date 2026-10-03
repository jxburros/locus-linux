# CLAUDE.md - Claude Instructions For Locus OS

Claude must follow `AGENTS.md` first, especially the instruction hierarchy.

## Required Skill

Before starting any meaningful task, invoke or read the `spec-driven-development` skill located at `skills/spec-driven-development/SKILL.md`.

## Task-Matched Skills

When a task matches one of these, read the skill before making changes:

- `skills/locus-platform-portability/SKILL.md` — any `src/core/` change, new browser API usage, dependencies, storage/persistence, or Core API design.
- `skills/locus-linux-translation/SKILL.md` — platform, packaging, native/OS-adjacent, or `locus-linux` integration decisions.
- `skills/locus-shell-design-language/SKILL.md` — any UI creation or change.
- `skills/locus-validation-loop/SKILL.md` — before finishing any code change.

## Required Reading

Before meaningful changes:

1. Read `AGENTS.md`.
2. Read `development-docs/coreIdentity.md`.
3. Consult `development-docs/developmentManifesto.md` for development, validation, AI, safety, or documentation rules.
4. Consult `development-docs/architecture.md` before architecture, Core, storage, AI, security, build, runtime, or generated-artifact changes.
5. Consult `development-docs/productRoadmap.md` before new capabilities or version-scope decisions.
6. Consult `development-docs/design.md` before any UX/UI, visual, or design-system decisions.

## Claude Change Process

Before editing:

- Identify governing docs and principles.
- Inspect only relevant files.
- Choose the smallest safe change.
- Preserve behavior unless explicitly changing it.
- Avoid broad rewrites and speculative architecture.

After editing:

- Run relevant validation.
- Update `CHANGELOG.md`.
- Update README or architecture docs if affected.
- Record skipped validation and uncertainty honestly.

## Changelog Name

When Claude updates `CHANGELOG.md`, use:

```text
Agent: Claude Code (Claude)
```

## Claude-Specific Cautions

Claude should be especially careful to avoid:

- Treating roadmap candidates as current work.
- Treating registry claims as implemented without checking code.
- Adding new Cores before wiring existing Cores.
- Leaving `architecture.md` stale after structural changes.
- Hiding incomplete validation.
- Making destructive or external changes without explicit user intent.

## Locus-Specific Priorities

Claude should prioritize:

- Core routing and enforcement.
- Local-first data safety.
- AI proposal transparency.
- Redaction and secret safety.
- Accurate docs over polished guesses.

Claude should avoid:

- App-private duplicate logic when a Core owns the behavior.
- Cloud/provider assumptions before explicit configuration.
- Silent data deletion.
- Claims that AI, encryption, sandboxing, or permissions are stronger than the code proves.

## Repo-Local Skills

Repo-local Codex skills are listed in `AGENTS.md` and installed under `.codex/skills/`; when a task matches one, read that skill before making changes.

