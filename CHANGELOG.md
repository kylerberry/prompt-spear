# Changelog

## Unreleased

## v0.1.2 — 2026-05-25

### Fixed
- **Critical:** `prompt-spear` binary silently exited with no output when invoked via `npm install` / `npx` / global bin shim. v0.1.0 and v0.1.1 were both affected — the ESM entry-point guard compared `import.meta.url` against `process.argv[1]` as raw strings, but npm's bin shim is a symlink so realpath resolution differed and the entry point never fired. Now uses `realpathSync` + `fileURLToPath` for correct comparison.

### Added
- Regression test (`src/__tests__/bin-entry.test.ts`) that symlink-invokes the built binary and asserts it produces output. Would have caught the above bug.

## v0.1.1 — 2026-05-24

### Changed
- **License changed from MIT to Apache 2.0.** This adds an explicit patent grant from contributors and an explicit patent-retaliation clause — better suited to a security-testing tool with enterprise CI use. v0.1.0 remains under MIT; v0.1.1+ is Apache 2.0. Existing MIT rights for v0.1.0 are irrevocable.
- New `NOTICE` file at repo root (Apache 2.0 §4(d) requirement).
- `package.json` `license` field updated to `Apache-2.0` (SPDX identifier).
- README license footer updated.

### Added
- Hero image at top of README (`docs/hero.webp`)
- Coverage badge in README (Coveralls)
- CI workflow with lint + build + test + coverage upload (`.github/workflows/ci.yml`)
- `test:coverage` script

## v0.1.0 — 2026-05-24

Initial release.

### Added
- CLI tool for auditing OpenAI-compatible LLM endpoints against prompt injection and jailbreak attacks
- Four attack categories: `direct-injection`, `role-override`, `system-prompt-extraction`, `encoding-obfuscation`
- Direct-injection probes include realism-tested patterns drawn from MITRE ATLAS T0051.000 case studies (authority-manipulation, decode-and-follow, content-frame override)
- Encoding-obfuscation includes alternate-language smuggling (French)
- Pattern-matching evaluator with `none_of` / `any_of` / `all_of` check operators
- Runner with configurable `--runs-per-probe` (majority vote) and `--concurrency`
- Severity-weighted scoring (critical=4, high=3, medium=2, low=1) with per-category and overall scores
- Pretty terminal output and JSON output (`--output`)
- Built-in demo targets (`--demo vulnerable | hardened`) for zero-setup testing
- Webhook adapter (`--request-template`) for non-OpenAI-compatible endpoints
- Exit code 0/1 on `--min-score` threshold for CI deployment gating
- 429 retry handling with exponential backoff (`--max-retries`)
- Verbose progress streaming (`--verbose`)
