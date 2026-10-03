---
name: ai-provider-api-key-safety
description: "Use when adding or changing AI provider integrations, BYOK settings, local model endpoints, API-key handling, model allowlists, model selection, request logging, or AI-generated structured outputs."
---

# AI Provider and API Key Safety

## Best-Fit Repositories

- `AI-Server-Studio`
- `Blobsmith`
- `Astra-log`
- `Secret-Census`
- `Taskalatte`
- `AI-model-test`
- `New-Gay-App-1`
- `Issues-Handler`
- `locus-os`

## Portfolio Provider Map

- BYOK in the browser: `Blobsmith` (provider allowlists, blocked-model rules, worker boundary), `Taskalatte` (optional assistant), `Secret-Census` (AI create/update blocks require user approval).
- Backend-held keys: `AI-Server-Studio` (encrypted provider keys plus local Ollama), `AI-model-test` (local endpoints and judge models; heuristic scorer stays network-free).
- Client Gemini features: `New-Gay-App-1`, `Costume-Game-2` - optional and key-safe; never required for core flows.
- Server/CI OpenAI: `Issues-Handler` (strict JSON triage contract), `QAI-ality` (missing AI keys must never fail the deterministic QA path).
- Brokered credentials: `locus-os` - apps and AI context receive references, never raw values; owner modules are `src/core/cores/secrets.ts`, `src/core/credentials.ts`, and `src/core/aiContext.ts`.
- `Astra-log`: AI-suggested terminal commands are never auto-run.

## Workflow

- Classify each provider as local, OpenAI-compatible, hosted cloud, or repo-specific SDK.
- Trace key entry, storage, transmission, logs, exports, and test fixtures.
- Use env-var references, local-only browser storage, or encrypted backend storage according to repo architecture.
- Keep provider allowlists, model registries, and blocked-model policies in one obvious module.

## Guardrails

- Never write raw API keys to SQLite, reports, generated artifacts, issue bodies, exports, screenshots, or logs.
- Do not invent current model names; use official docs when current OpenAI model guidance matters.
- Do not let AI-generated JSON mutate app state without explicit validation and user approval when the repo has that pattern.

## Validation

- Search generated artifacts for key-like strings.
- Run provider-free fallback tests.
- Verify invalid/missing key UX and local model endpoint behavior.
