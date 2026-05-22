# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`llm-audit-scorecard` is an open-source CLI and library for auditing LLM API endpoints against a battery of prompt injection and jailbreak test cases. It produces a scored report showing which attack categories passed, failed, or were flagged as uncertain.

## Intended Architecture

- **`src/probes/`** — Individual test probes, one file per attack category (e.g., `role-override.ts`, `instruction-injection.ts`, `context-leakage.ts`). Each probe exports a `Probe` interface with `id`, `name`, `category`, and `run(endpoint) → ProbeResult`.
- **`src/runner.ts`** — Orchestrates running all (or filtered) probes against a target endpoint, collects results, computes scores.
- **`src/report.ts`** — Formats results as JSON, Markdown, or terminal output.
- **`src/endpoint.ts`** — Abstraction for calling an LLM endpoint (OpenAI-compatible API shape by default). Callers inject this to support any provider.
- **`src/cli.ts`** — Entry point for the CLI (`npx llm-audit-scorecard --endpoint <url>`).
- **`src/types.ts`** — Shared types: `Probe`, `ProbeResult`, `AuditReport`, `Score`.

## Tech Stack Decisions

- TypeScript with strict mode
- Node.js (no frontend)
- `vitest` for tests
- `zod` for runtime schema validation of config and API responses
- OpenAI SDK used as the HTTP client (supports any OpenAI-compatible endpoint)
- `commander` for CLI arg parsing

## Commands

Once initialized, standard commands will be:

```bash
npm run build       # tsc compile to dist/
npm run dev         # ts-node watch mode
npm run test        # vitest
npm run test:run    # vitest --run (single pass, for CI)
npm run lint        # eslint src/
```

Run a single test file:
```bash
npx vitest run src/probes/role-override.test.ts
```

## Probe Design Contract

Each probe must:
1. Be deterministic in its prompt construction
2. Return a `pass | fail | uncertain` verdict with reasoning
3. Not depend on other probes (probes run in parallel)
4. Include at least one positive control (known-safe input that should pass)

## Scoring

Scores are per-category (e.g., "System Prompt Leakage", "Role Override", "Indirect Injection"). Overall score = weighted average across categories, configurable via `audit.config.json`.

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
