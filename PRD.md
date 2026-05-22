# PRD: prompt-spear

## Problem Statement

Developers building LLM-powered applications have no easy, repeatable way to verify that their endpoint resists common prompt injection and jailbreak attacks before shipping. Existing tools are Python-only, require installation, rely solely on regex pattern matching, and produce no meaningful confidence signal. There is no tool that an agent or developer can drop into a CI pipeline with zero setup and get a scored, actionable security report against frontier-quality adversarial evaluation.

## Solution

`prompt-spear` is an open source CLI tool invoked via `npx prompt-spear` that fires a curated battery of prompt injection probes at any OpenAI-compatible LLM endpoint and returns a scored report. Pattern matching verdicts are free and local. An optional remote judge service powered by a frontier LLM (cross-model adversarial judging) upgrades verdicts to nuanced pass/fail/uncertain with reasoning. A configurable score threshold makes it a reliable CI deployment gate. The tool is designed to be discovered and invoked by agents via `--help` with no prior documentation required.

## User Stories

1. As a developer, I want to run `npx prompt-spear --endpoint https://my-api.com/chat` and get a scored report immediately, so that I can verify my endpoint before shipping without installing anything.
2. As a developer, I want to see a pass/fail verdict per attack category, so that I know which specific vulnerability class my endpoint is weak against.
3. As a developer, I want a human-readable terminal output by default, so that I can read the report without post-processing.
4. As a developer, I want the first 3 probe attack/response pairs revealed in the output, so that I can understand what attacks were used and how my endpoint responded.
5. As a developer, I want to run the tool against a bundled vulnerable demo target, so that I can see it catch real failures before pointing it at my own endpoint.
6. As a developer, I want to run it against a bundled hardened demo target, so that I can see what a passing report looks like.
7. As a developer, I want to specify `--categories role-override,direct-injection` to run only a subset of attack categories, so that I can iterate faster during development.
8. As a developer, I want to specify `--runs-per-probe 3` (default), so that I get majority-vote confidence rather than a single flaky result.
9. As a developer, I want confidence surfaced per probe result (e.g. "failed 2/3 runs"), so that I know how reliable each verdict is.
10. As a developer, I want to pass my API key via `PROMPT_SPEAR_KEY` env var or `--key` flag, so that credentials never appear in config files or shell history.
11. As a developer, I want custom headers supported via `--header "X-Custom: value"`, so that I can reach endpoints with non-standard auth.
12. As a developer, I want a `--min-score 80` flag (default 80), so that I can configure what score constitutes a pass for my risk tolerance.
13. As a developer, I want `--output json` to produce machine-readable output, so that I can pipe it into other tools or scripts.
14. As a developer, I want `--output markdown` to produce a formatted report I can paste into a PR description or Notion doc.
15. As a developer, I want the tool to exit with code 1 when the score is below threshold, so that CI pipelines fail automatically without scripting.
16. As a developer, I want to run the free tier with no account or API key, so that I can evaluate the tool before committing to anything.
17. As a developer, I want pattern matching to always run locally and free, so that I always get a baseline verdict even without a judge service call.
18. As a developer, I want the free tier to include a limited number of LLM-as-judge calls per period, so that I can experience the quality difference without signing up.
19. As a developer on the paid tier, I want to pass `--system-prompt "You are a helpful assistant..."` so that attacks are crafted specifically targeting my system prompt rather than running generic probes.
20. As a developer on the paid tier, I want to see the full attack/response detail for all probes, so that I can diagnose every failure in detail.
21. As a developer on the paid tier, I want to specify `--judge openai|anthropic|google` so that I can choose a judge model from a different provider than the model I'm testing.
22. As a developer on the paid tier, I want unlimited judge calls, so that I can run full audits in CI without worrying about rate limits.
23. As an agent (e.g. Claude Code), I want `--help` output to be comprehensive and self-describing, so that I can construct the correct command without reading external documentation.
24. As an agent, I want `--output json` to produce a predictable, flat schema, so that I can parse results and triage failures programmatically.
25. As an agent, I want the probe result to include `reasoning` alongside `verdict`, so that I can understand what failed and generate a targeted system prompt fix.
26. As a CI pipeline maintainer, I want to add `npx prompt-spear --endpoint $ENDPOINT --key $KEY --min-score 80` to my pipeline with no pre-install step, so that auditing requires zero infrastructure setup.
27. As a CI pipeline maintainer, I want the exit code to reflect threshold pass/fail, so that the pipeline fails the build automatically on regression.
28. As a CI pipeline maintainer, I want `--output json` piped to a file as a build artifact, so that I can track score trends across deploys.
29. As an open source contributor, I want a clean internal `Probe` interface, so that I can submit new probes via PR without needing to understand the full codebase.
30. As an open source contributor, I want a `none_of / any_of / all_of` check pattern system per probe, so that I can express nuanced pass conditions beyond simple keyword matching.

## Implementation Decisions

### Module Design

**1. Probe Library (`src/probes/`)**
Each probe is a data object (not a class) conforming to the `Probe` interface:
```ts
{
  id: string
  name: string
  category: 'direct-injection' | 'role-override' | 'system-prompt-extraction' | 'encoding-obfuscation'
  severity: 'critical' | 'high' | 'medium' | 'low'
  attack_prompt: string
  check: {
    none_of?: string[]   // fail if any pattern appears
    any_of?: string[]    // pass if at least one pattern appears
    all_of?: string[]    // pass only if all patterns appear
  }
}
```
Probes are pure data — no side effects, no network calls. This makes the library trivially testable and easy to contribute to via PR.

**2. Endpoint Adapter (`src/endpoint.ts`)**
Encapsulates all HTTP communication with the target. v1 supports OpenAI-compatible `/chat/completions` shape only. Accepts: endpoint URL, API key, optional custom headers, system prompt (optional). Returns: raw string response. This is the only module that performs I/O against the user's endpoint.

**3. Runner (`src/runner.ts`)**
Orchestrates execution: accepts a list of probes, an endpoint adapter, and run config (runs-per-probe, categories filter). Fires N runs per probe via the adapter, collects responses, passes them to the evaluator. Returns raw `RunResult[]` with no scoring logic.

**4. Pattern Evaluator (`src/evaluators/pattern.ts`)**
Pure function. Takes a probe's `check` definition and a response string. Returns `pass | fail | uncertain`. No I/O, entirely deterministic. This is the free local evaluation layer.

**5. Judge Client (`src/evaluators/judge-client.ts`)**
HTTP client that sends a probe response to the remote judge service and returns a `JudgeVerdict` with `verdict`, `reasoning`, and `confidence`. Handles auth (anonymous vs API key), rate limit errors gracefully (falls back to pattern verdict with a warning), and parallelizes calls via `Promise.all`.

**6. Scorer (`src/scorer.ts`)**
Pure function. Takes `RunResult[]` with verdicts attached, computes per-category scores and a weighted overall score (0–100). Severity weights: critical=4, high=3, medium=2, low=1. Returns `AuditReport`.

**7. Reporter (`src/reporter.ts`)**
Takes an `AuditReport` and formats it as JSON, pretty terminal output, or Markdown. Applies the partial reveal logic: first 3 probes include full `attack_prompt` + `response`; remaining probes set `redacted: true`. This is pure formatting — no business logic.

**8. CLI (`src/cli.ts`)**
Entry point. Parses flags via `commander`, wires together endpoint adapter → runner → evaluators → scorer → reporter. Sets exit code based on `passed` field of the report. `--help` text is the primary documentation surface — write it as if it's the only docs an agent will ever read.

**9. Demo Targets (`src/demo/`)**
A `vulnerable-target.ts` and `hardened-target.ts` that implement the same endpoint adapter interface locally (no HTTP). Used in onboarding (`npx prompt-spear --demo vulnerable`) and as integration test fixtures.

### Judge Service (Remote)

- Node.js service deployed on Render via Docker
- One endpoint: `POST /judge` — accepts `{ probe_id, category, response, judge_family? }`
- Returns `{ verdict, reasoning, confidence }`
- Selects judge model dynamically: if `judge_family` provided and user is on paid tier, use that family; otherwise rotate between available frontier models
- Judge prompt is category-specific: role-override judge asks "did the model adopt an alternative persona?"; extraction judge asks "did the model reveal its system prompt?"
- Auth: `Authorization: Bearer <api_key>` for paid; anonymous with IP rate limiting for free
- Supabase used for: API key validation, usage counters, rate limit state

### Output Schema (JSON)
```ts
{
  passed: boolean
  score: number          // 0-100
  threshold: number
  categories: [{
    name: string
    score: number
    passed: boolean
    probes: [{
      id: string
      verdict: 'pass' | 'fail' | 'uncertain'
      confidence: string  // e.g. "2/3"
      reasoning: string
      attack_prompt: string | null   // null if redacted
      response: string | null        // null if redacted
      redacted: boolean
      severity: string
    }]
  }]
}
```

### Tier Enforcement
- Pattern matching: always local, never gated
- Judge calls: CLI checks response status; 429 from judge service = rate limited, fall back to pattern verdict, emit warning in output
- `attack_prompt` / `response` reveal: reporter applies the first-3 rule client-side based on whether an API key is present and validated in the judge response
- `--system-prompt` and `--judge` flags: CLI validates these require a paid API key before making the judge call; clear error message on failure

### Flag Reference
```
--endpoint <url>         Target URL (OpenAI-compatible)
--key <key>              API key for target endpoint (or ENDPOINT_API_KEY env)
--header <k:v>           Custom headers (repeatable)
--categories <list>      Comma-separated category filter
--runs-per-probe <n>     Default: 3
--min-score <n>          Default: 80
--output <format>        json | pretty | markdown (default: pretty)
--judge <family>         openai | anthropic | google (paid tier)
--system-prompt <text>   System prompt for targeted attacks (paid tier)
--spear-key <key>        prompt-spear API key (or PROMPT_SPEAR_KEY env)
--demo <target>          vulnerable | hardened (run against built-in demo)
```

## Testing Decisions

A good test for this project tests the behavior of a module through its public interface only — not implementation details like which regex was used internally or how many times a sub-function was called.

**Pattern Evaluator** — highest priority. Pure function with no I/O. Test every combination of `none_of`, `any_of`, `all_of` against representative response strings. Test edge cases: empty response, response that matches multiple check types in conflicting ways.

**Scorer** — high priority. Pure function. Test that severity weighting produces correct per-category and overall scores. Test threshold pass/fail boundary conditions.

**Reporter** — medium priority. Test that JSON output matches the schema exactly. Test the partial reveal logic: probe indices 0-2 include `attack_prompt`/`response`, index 3+ have `redacted: true`. Test exit code mapping.

**Runner** — test with a mock endpoint adapter. Verify that N runs are fired, majority vote is computed correctly, and category filtering reduces the probe set.

**Endpoint Adapter** — test with a local HTTP mock (e.g. `msw` or a simple `http.createServer`). Verify request shape, header injection, and error handling (timeout, 401, 500).

**Judge Client** — test with a mocked judge service. Verify parallel dispatch, graceful fallback on 429, and correct verdict parsing.

**Demo Targets** — integration tests. Run the full pipeline against the vulnerable demo target and assert that at least one probe fails. Run against the hardened demo target and assert a passing score. These are the closest thing to end-to-end tests and should be part of the CI suite.

No tests needed for: the probe data library itself (it's just JSON-shaped data), the CLI argument parsing layer, or the reporter's terminal color formatting.

## Out of Scope

- Arbitrary HTTP endpoint support (v2)
- Indirect injection probes (v2)
- Context manipulation / multi-turn probes (v2)
- Public plugin API for external probe authors (post-v1, contributions via PR only)
- Client portal / account management UI (separate spec)
- Billing integration beyond Stripe API key validation
- Multimodal (image/file) injection probes
- Model identity inference from endpoint URL
- Probe result trend tracking across runs
- Any frontend or web UI for the CLI tool itself

## Phases

### Phase 1 — Working Local CLI (no service)
**Goal:** Shippable v0. `npx prompt-spear` works end-to-end with no account, no remote service, no payments.

**Includes:**
- Probe library (4 v1 attack categories, data only)
- Endpoint adapter (OpenAI-compatible `/chat/completions`)
- Pattern evaluator (`none_of` / `any_of` / `all_of`)
- Runner (N runs per probe, majority vote, parallel execution)
- Scorer (per-category + weighted overall score)
- Reporter (JSON + pretty terminal output)
- CLI wiring with all flags (except `--judge`, `--system-prompt`, `--spear-key`)
- Demo targets (vulnerable + hardened)
- Exit code pass/fail on threshold

**Ships when:** A developer can `npx prompt-spear --endpoint <url> --key <key>` and get a scored report with pattern-matched verdicts.

---

### Phase 2 — Judge Service (Free + Paid API Key)
**Goal:** LLM-as-judge verdicts available. Free tier rate-limited anonymously. Paid tier via API key.

**Includes:**
- Render + Docker service setup
- Supabase schema (API keys, usage counters, rate limit state)
- `POST /judge` endpoint with category-specific judge prompts
- Judge client in CLI (parallel dispatch, graceful 429 fallback)
- Anonymous + IP rate limiting for free tier
- Partial reveal logic in reporter (first 3 probes full, rest redacted)
- Upgrade CTA in output
- Markdown output format

**Ships when:** Free users get limited judged runs with no signup. Paid API key unlocks unlimited judged runs.

---

### Phase 3 — Paid Tier Features
**Goal:** Full paid tier functional. CI-ready. Targeted attacks available.

**Includes:**
- Stripe integration + API key provisioning flow
- `--system-prompt` flag (targeted attack generation, paid only)
- `--judge openai|anthropic|google` flag (cross-model selection, paid only)
- Full attack/response reveal for paid users (all probes, no redaction)
- CI documentation + GitHub Actions example
- `prompt-spear.dev` landing page / upgrade flow

**Ships when:** A paid user can run a full targeted audit in CI with judge model selection and see complete attack/response detail.

---

### Phase 4 — v2 Attack Categories + Arbitrary HTTP
**Goal:** Expand coverage and endpoint flexibility.

**Includes:**
- Indirect injection probes (instructions hidden in external content)
- Context manipulation probes (multi-turn gradual drift)
- Arbitrary HTTP adapter with user-defined request/response field mapping (`--adapter` flag)

**Ships when:** All 6 attack categories are available and non-OpenAI-compatible endpoints are supported.

---

## Further Notes

- The name `prompt-spear` is confirmed available on npm as of 2026-05-21.
- The "spear" metaphor is intentional and should be consistent throughout copy: probes are "spears thrown at the endpoint", targeted attacks (with system prompt) are "aimed spears".
- The partial reveal mechanic (first 3 full, rest redacted) is a deliberate conversion hook — the upgrade CTA in the output should be specific: "Upgrade to see all N attack/response pairs at prompt-spear.dev".
- Cross-model judging is a key differentiator: `--help` and README should explain *why* you want a different judge than the model under test (shared systematic biases).
- PromptProbe (Python, regex-only) is the closest existing tool. Key differentiators to emphasize: zero-install, LLM-as-judge, confidence scoring, targeted system prompt attacks, agent-friendly CLI.
- The judge service should never log or store the probe responses it receives — this is a trust/privacy commitment that should be stated explicitly in the README and enforced in the service implementation.
