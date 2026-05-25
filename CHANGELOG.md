# Changelog

## v0.1.1 — 2026-05-24

### Added
- Coverage badge in README (Coveralls)

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
