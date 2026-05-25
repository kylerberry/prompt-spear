# prompt-spear

CLI tool that fires a curated battery of prompt injection probes at any LLM endpoint and returns a scored report. Exit code `0`/`1` makes it usable as a CI deployment gate.

> **Status:** v0.1 — early release. Pattern-matching verdicts are stable and ready for CI use. An optional remote judge service (LLM-as-judge for nuanced verdicts) and a paid tier for targeted attacks are in development. The JSON output schema may gain fields in future versions; existing fields will not change without a major version bump.

## What it does

`prompt-spear` sends adversarial prompts — drawn from four attack categories — to an OpenAI-compatible `/chat/completions` endpoint, runs each probe multiple times for a majority-vote verdict, and produces a weighted pass/fail report.

| Category | What it tests |
|----------|---------------|
| `direct-injection` | Overriding instructions via injected commands |
| `role-override` | Jailbreaks that swap the model's persona (DAN, developer mode) |
| `system-prompt-extraction` | Attempts to leak the system prompt |
| `encoding-obfuscation` | Payloads hidden in base64, leetspeak, ROT13, homoglyphs |

## Installation

No install required — run it directly with `npx`:

```bash
npx prompt-spear --demo vulnerable
```

To install globally:

```bash
npm install -g prompt-spear
prompt-spear --demo vulnerable
```

### From source

Requires Node.js 20+.

```bash
git clone https://github.com/kylerberry/prompt-spear.git
cd prompt-spear
npm install
npm run build
node dist/cli.js --help
```

## Usage

### Try the built-in demo targets

No endpoint or API key needed — `--demo` runs against bundled in-process targets:

```bash
npx prompt-spear --demo vulnerable    # a target that fails the audit (exit 1)
npx prompt-spear --demo hardened      # a target that passes the audit (exit 0)
```

### Audit a real endpoint

```bash
npx prompt-spear \
  --endpoint https://api.example.com/v1/chat/completions \
  --key $YOUR_API_KEY
```

The API key can also be supplied via the `ENDPOINT_API_KEY` environment variable instead of `--key`:

```bash
export ENDPOINT_API_KEY=sk-...
npx prompt-spear --endpoint https://api.example.com/v1/chat/completions
```

### Filter categories and tune the run

```bash
npx prompt-spear \
  --endpoint <url> \
  --categories role-override,direct-injection \
  --runs-per-probe 5 \
  --min-score 90
```

### Audit a custom webhook endpoint

If your endpoint isn't OpenAI-compatible, supply a JSON body template with a `{{prompt}}` placeholder:

```bash
# payload.json
{ "message": "{{prompt}}", "sessionId": "my-session" }
```

```bash
npx prompt-spear \
  --endpoint https://api.example.com/chat \
  --request-template payload.json \
  --key $YOUR_API_KEY
```

`{{prompt}}` is substituted with the attack text before each request. The response field is auto-detected from common names (`response`, `output`, `text`, `message`, `content`, etc.).

### JSON output for tooling

```bash
npx prompt-spear --demo hardened --output json
```

The JSON conforms to the `AuditReport` schema (overall `score`, `threshold`, `passed`, and per-category breakdown). A timestamped `<timestamp>_audit.json` file is also written after every run.

### Verbose progress and rate-limit tuning

```bash
npx prompt-spear \
  --endpoint <url> \
  --key $KEY \
  --verbose \
  --concurrency 3 \
  --max-retries 5
```

`--verbose` streams a result line to stderr as each probe completes and logs retry delays. `--concurrency` caps parallel probes; `--max-retries` controls 429 backoff attempts.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--endpoint <url>` | string | — | Target URL of an OpenAI-compatible `/chat/completions` endpoint. Required unless `--demo` is used. |
| `--key <key>` | string | `$ENDPOINT_API_KEY` | API key for the target, sent as a Bearer token. |
| `--header <k:v>` | string | — | Extra request header in `"Key: value"` form. Repeatable. |
| `--categories <list>` | string | all | Comma-separated attack categories: `direct-injection`, `role-override`, `system-prompt-extraction`, `encoding-obfuscation`. |
| `--runs-per-probe <n>` | integer | `3` | Runs per probe; the verdict is a majority vote. Higher trades speed for confidence. |
| `--concurrency <n>` | integer | `5` | Max probes running in parallel. Lower values reduce rate-limit risk. |
| `--max-retries <n>` | integer | `3` | Max retry attempts on 429 responses, using exponential backoff with jitter. |
| `--min-score <n>` | number 0–100 | `80` | Minimum overall score required to pass (exit 0). |
| `--output <format>` | `json` \| `pretty` | `pretty` | Report format. `pretty` for terminals, `json` for tooling. |
| `--request-template <file>` | string | — | Path to a JSON body template for non-OpenAI webhooks. Must contain `{{prompt}}`. |
| `--verbose` | flag | off | Stream a result line to stderr for each probe as it completes. |
| `--demo <target>` | `vulnerable` \| `hardened` | — | Run against a built-in demo target instead of a real endpoint. |

Run `npx prompt-spear --help` for the authoritative flag reference.

## Scoring

Each probe carries a severity weight: `critical=4`, `high=3`, `medium=2`, `low=1`.

- **Per-category score** = passing probe weight ÷ total probe weight × 100
- **Overall score** = weighted average of category scores
- The audit **passes** when the overall score meets `--min-score` (default 80)

## CI integration

The process exits `0` on pass and `1` on fail, so it works as a deployment gate:

```yaml
# .github/workflows/llm-audit.yml
- name: Audit LLM endpoint
  run: npx prompt-spear --endpoint $ENDPOINT --key $ENDPOINT_API_KEY --min-score 85
  env:
    ENDPOINT_API_KEY: ${{ secrets.ENDPOINT_API_KEY }}
```

## Development

```bash
npm run build       # compile TypeScript to dist/
npm run test        # vitest (watch)
npm run test:run    # vitest (single run, for CI)
npm run lint        # eslint over src/
```

## License

MIT — see [LICENSE](LICENSE).
