# skill-map.md

Skills selected for prompt-spear. Only skills with a clear mapping to at least one domain are included.

## Selected Skills

| Name | Installs | Purpose | Source |
|------|----------|---------|--------|
| `tdd` | 141.5K | TDD workflow — mandatory red/green/refactor cycle. Critical for pure modules (pattern evaluator, scorer). | mattpocock/skills |
| `improve-codebase-architecture` | 146.9K | Architecture review — identifies shallow modules, leaky abstractions, and coupling. Use before Phase 2 judge service design. | mattpocock/skills |
| `security-review` | built-in | Security audit of diffs. Use during CRAFTS Tighten phase on every PR, especially judge service and key validation code. | built-in |
| `security-scan` | — | Automated security scanning. Complements security-review for the judge service and Stripe webhook handler. | built-in |
| `handoff` | 61.5K | Agent session handoff — packages context for the next agent when a task spans sessions. Use when handing off between Phase 1 waves. | mattpocock/skills |
| `supabase-development` | — | Supabase schema design, migrations, RLS policies. Directly supports Issue #14 (Supabase schema for API keys + rate limiting). | user skills |
| `supabase:supabase` | — | Supabase patterns and best practices. Companion to supabase-development. | supabase plugin |
| `claude-api` | built-in | Claude API / Anthropic SDK usage, prompt caching, tool use. Required for judge service implementation (Issues #13, #19) — judge calls Anthropic API. | built-in |
| `skrillz:api-testing` | — | API endpoint testing patterns. Use for judge service `POST /judge` and `POST /generate-probes` test coverage. | skrillz |
| `skrillz:tdd-workflow` | — | Extended TDD workflow with CI integration. Companion to `tdd` for the runner and scorer modules. | skrillz |
| `skrillz:anthropic-expert` | — | Deep Anthropic API patterns. Use when designing category-specific judge prompts (Issue #13) and targeted probe generation (Issue #19). | skrillz |
| `codex:rescue` | — | Second-pass implementation when stuck. Use if an agent gets blocked on the multi-turn context manipulation probes (Issue #24) or the arbitrary HTTP adapter DSL (Issue #25). | codex plugin |

## Domain Mapping

| Domain | Skills |
|--------|--------|
| **CLI + Runner** (`src/cli.ts`, `src/runner.ts`) | `tdd`, `skrillz:tdd-workflow`, `handoff` |
| **Probe Library + Evaluators** (`src/probes/`, `src/evaluators/`) | `tdd`, `skrillz:tdd-workflow`, `skrillz:anthropic-expert` |
| **Judge Service** (`services/judge/`) | `claude-api`, `skrillz:anthropic-expert`, `skrillz:api-testing`, `security-review`, `security-scan` |
| **Infrastructure** (Supabase, Stripe, Render) | `supabase-development`, `supabase:supabase`, `security-review` |
| **Cross-cutting** | `improve-codebase-architecture`, `handoff`, `codex:rescue` |

## Gaps (Build-or-Borrow Decisions)

| Capability | Gap | Decision |
|-----------|-----|----------|
| **Render + Docker deployment** | No skill covers Render-specific deploy patterns or Docker configuration for Node.js services. | **Build** — Render's DX is simple enough; write a `Dockerfile` and `render.yaml` from scratch. |
| **Stripe webhook integration** | No skill covers Stripe webhook handling, signature verification, or subscription lifecycle. | **Borrow** — Use Stripe's official Node.js SDK and follow their webhook verification docs directly. Flag Issue #18 as HITL. |
| **Prompt injection probe authoring** | No skill exists for writing adversarial LLM test cases or curating attack libraries. | **Build** — this is core IP. Research OWASP LLM Top 10 and existing red-teaming literature manually. |
| **CLI package publishing (npm)** | No skill covers `npm publish`, package versioning, or `npx` binary setup. | **Build** — straightforward `package.json` `bin` field + `npm publish` in CI. |
