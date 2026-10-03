# CLAUDE.md - Claude Instructions For Locus Linux

Claude must follow `AGENTS.md` first — especially the hard constraints: the upstream kernel tree stays pristine, all Locus content lives under `locus/` (plus root agent docs), and kernel patches require a maintainer decision record.

## Required Reading

1. `AGENTS.md`.
2. `locus/README.md`.
3. `locus/docs/readiness-plan.md` for plan state and open decisions.
4. `locus/docs/integration-plan.md` and `locus/docs/reference-guide.md`.
5. For shell work, `locus/shell/AGENTS.md` and its local task-matched skills.

## Task-Matched Skills

- `locus/skills/locus-kernel-fork-hygiene/SKILL.md` — anything touching kernel sources, upstream sync, branches, or tree layout.
- `locus/skills/locus-image-boot/SKILL.md` — kernel configs, image building, boot/session components, or image CI.

## Changelog Name

When Claude updates `locus/CHANGELOG.md`, use:

```text
Agent: Claude Code (Claude)
```

## Claude-Specific Cautions

- Do not "improve" upstream kernel code, comments, or docs — this tree tracks upstream byte-for-byte outside `locus/`.
- Do not treat readiness-plan items (LTS pin, image builder, `locus-cored`) as started work; they are gated on maintainer decisions.
- Do not run full kernel builds for changes that cannot affect the build; say what validation was skipped and why.
- Locus OS identity constraints (local-first, proposal-governed AI, no telemetry/cloud by default) bind image and userspace decisions made here.
