# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`prompt-spear` — open source CLI tool (`npx prompt-spear`) that audits LLM endpoints against prompt injection and jailbreak attack categories. Produces a scored report with pass/fail per category and an overall score. Exit code 0/1 makes it usable as a CI deployment gate.

**Judge service lives in a separate repo.** This repo is the CLI only.

See `PRD.md` for full spec, `skill-map.md` for skills, `CRAFTS.md` for development workflow.

## Development Workflow

Follow **CRAFTS** for all non-trivial work. See `CRAFTS.md`.

- **Full flow** (business logic, multiple files): C → R → A → F → T → S
- **Lite flow** (config, single-file fixes): R → S only
- Key skills: `/tdd` (red/green/refactor), `/security-review` (every PR), `/improve-codebase-architecture` (before major modules), `/handoff` (between sessions)

## Module Architecture

Each module has a single responsibility. Dependency order matches build order:

| Module | File | Responsibility |
|--------|------|----------------|
| Types | `src/types.ts` | Shared interfaces only — no runtime code |
| Probe Library | `src/probes/` | Pure data objects, one file per category |
| Pattern Evaluator | `src/evaluators/pattern.ts` | Pure fn: `evaluate(check, response) → Verdict` |
| Endpoint Adapter | `src/endpoint.ts` | Only module that does I/O against the target |
| Runner | `src/runner.ts` | Fires N runs per probe, majority vote, returns `ProbeResult[]` |
| Scorer | `src/scorer.ts` | Pure fn: weighted score per category + overall |
| Reporter | `src/reporter.ts` | Formats `AuditReport` as JSON / pretty / markdown |
| Judge Client | `src/evaluators/judge-client.ts` | HTTP client for remote judge service (parallel, graceful 429 fallback) |
| CLI | `src/cli.ts` | Wires everything together, parses flags, sets exit code |
| Demo Targets | `src/demo/` | Local vulnerable + hardened targets for `--demo` flag and tests |

## Probe Interface

Probes are **pure data objects** — no methods, no side effects:

```ts
{
  id: string
  name: string
  category: 'direct-injection' | 'role-override' | 'system-prompt-extraction' | 'encoding-obfuscation'
  severity: 'critical' | 'high' | 'medium' | 'low'
  attack_prompt: string
  check: { none_of?: string[]; any_of?: string[]; all_of?: string[] }
}
```

`none_of` takes precedence over `any_of`/`all_of` when multiple check types are present.

## Scoring

Severity weights: critical=4, high=3, medium=2, low=1. Per-category score = passing probe weight / total probe weight × 100. Overall = weighted average of category scores. Default pass threshold = 80 (configurable via `--min-score`).

## CLI Flags

```
--endpoint <url>        OpenAI-compatible target URL
--key <key>             Target API key (or ENDPOINT_API_KEY env)
--header <k:v>          Custom headers (repeatable)
--categories <list>     Comma-separated category filter
--runs-per-probe <n>    Default: 3 (majority vote for confidence)
--min-score <n>         Default: 80
--output <format>       json | pretty | markdown (default: pretty)
--spear-key <key>       prompt-spear API key for judge service (or PROMPT_SPEAR_KEY env)
--judge <family>        openai | anthropic | google (paid tier)
--system-prompt <text>  Target system prompt for targeted attacks (paid, or @file.txt)
--demo <target>         vulnerable | hardened
```

## Tier Model

- **Free unlimited** — local pattern matching only, no `--spear-key` required
- **Free limited** — anonymous judge calls (IP rate limited), no signup
- **Paid** — unlimited judge, `--judge` flag, `--system-prompt` flag, full probe detail in output

Partial reveal: first 3 probes show full `attack_prompt` + `response`; remaining are redacted on free tier.

## Tech Stack

- TypeScript strict mode, Node.js
- `vitest` for tests — run a single file: `npx vitest run src/evaluators/pattern.test.ts`
- `commander` for CLI arg parsing
- `zod` for config and response validation
- Native `fetch` for HTTP (no SDK dependency for endpoint calls)

## Gotchas

**Commander coercion second argument:** Commander calls coercion functions as `coerce(value, previousValue)` where `previousValue` is the option's default. If your coercion function has optional parameters, the default value bleeds in as that param. Always pass coercions as arrow function wrappers, never as direct references:

```ts
// Wrong — commander passes default (e.g. 3) as the second arg, corrupting `min`
.option('--runs-per-probe <n>', '...', parseIntOption, 3)

// Right — arrow wrapper ignores commander's second arg
.option('--runs-per-probe <n>', '...', (raw) => parseIntOption(raw), 3)
```

**Vitest fs mock state leak:** When mocking `readFileSync` with `vi.fn()`, call `mockedReadFileSync.mockReset()` in `afterEach`. Without it, a `mockReturnValue` set in one test persists into the next, causing false passes or unexpected failures.

## Commands

```bash
npm run build       # tsc → dist/
npm run test        # vitest watch
npm run test:run    # vitest --run (CI)
npm run lint        # eslint src/
```

## Issue Tracker

GitHub Issues: https://github.com/kylerberry/prompt-spear/issues

Phase 1 (local CLI) issues: #2–#11. Start with #2 (bootstrap) — it has no blockers. Issues #3–#6 can run in parallel once #2 merges. See issue bodies for file ownership per slice.

---

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
