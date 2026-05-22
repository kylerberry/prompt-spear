# skill-map.md

Skills selected for prompt-spear. Only skills with a clear mapping to at least one domain are included.

## Selected Skills

| Name | Installs | Purpose | Source |
|------|----------|---------|--------|
| `tdd` | 141.5K | TDD workflow — mandatory red/green/refactor cycle. Critical for pure modules (pattern evaluator, scorer). | mattpocock/skills |
| `improve-codebase-architecture` | 146.9K | Architecture review — identifies shallow modules, leaky abstractions, and coupling. | mattpocock/skills |
| `security-review` | built-in | Security audit of diffs. Use during CRAFTS Tighten phase on every PR. | built-in |
| `security-scan` | — | Automated security scanning. Use on every PR touching the CLI key handling or judge client. | built-in |
| `handoff` | 61.5K | Agent session handoff — packages context for the next agent when a task spans sessions. Use when handing off between Phase 1 waves. | mattpocock/skills |
| `skrillz:tdd-workflow` | — | Extended TDD workflow with CI integration. Companion to `tdd` for the runner and scorer modules. | skrillz |
| `skrillz:anthropic-expert` | — | Deep Anthropic API patterns. Use when authoring probe check patterns and understanding model behavior for edge case coverage. | skrillz |
| `codex:rescue` | — | Second-pass implementation when stuck. Use if an agent gets blocked on the multi-turn context manipulation probes (Issue #24) or the arbitrary HTTP adapter DSL (Issue #25). | codex plugin |

## Domain Mapping

| Domain | Skills |
|--------|--------|
| **CLI + Runner** (`src/cli.ts`, `src/runner.ts`) | `tdd`, `skrillz:tdd-workflow`, `handoff`, `security-review` |
| **Probe Library + Evaluators** (`src/probes/`, `src/evaluators/`) | `tdd`, `skrillz:tdd-workflow`, `skrillz:anthropic-expert` |
| **Judge Client** (`src/evaluators/judge-client.ts`) | `tdd`, `security-review`, `security-scan` |
| **Cross-cutting** | `improve-codebase-architecture`, `handoff`, `codex:rescue` |

## Gaps (Build-or-Borrow Decisions)

| Capability | Gap | Decision |
|-----------|-----|----------|
| **Prompt injection probe authoring** | No skill exists for writing adversarial LLM test cases or curating attack libraries. | **Build** — this is core IP. Research OWASP LLM Top 10 and existing red-teaming literature manually. |
| **CLI package publishing (npm)** | No skill covers `npm publish`, package versioning, or `npx` binary setup. | **Build** — straightforward `package.json` `bin` field + `npm publish` in CI. |
