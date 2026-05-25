---
name: cli-release
description: MANDATORY before every commit to the cli repo's `main` branch. Decides if the change warrants a semver version bump, then bumps + tags + publishes to npm. Skip only for branches other than main, or commits that touch zero shipped surface area.
---

# CLI release procedure

Run this **before** creating a commit on `main`. The skill makes the semver call, then mechanically executes the release if a bump is warranted.

## 0. Preflight

```bash
cd /Users/kylerberry/Projects/prompt-spear/cli
git rev-parse --abbrev-ref HEAD       # must print: main
git status --short                     # review what's about to be committed
git fetch --tags
git describe --tags --abbrev=0         # last shipped version (e.g. v0.1.0)
```

If branch ≠ `main`, **stop** — this skill only runs on main.

## 1. Decide bump type from the diff

```bash
git diff $(git describe --tags --abbrev=0) -- . ':!node_modules' ':!dist' --stat
```

Then classify:

| Bump | Trigger (any one is enough) |
|---|---|
| **Major** (1.0.0 → 2.0.0) | Removed/renamed a CLI flag. Repurposed an exit code (e.g. changing what exit 1 means). Changed shape of an existing field in JSON output. Bumped required Node `engines`. |
| **Minor** (0.1.0 → 0.2.0) | Added a CLI flag. Added a new field to JSON output (additive). New attack category. New `evaluator` mode. New probe class that materially changes audit coverage. **Adding a new exit code goes here** (additive, even though some `set -e` users may notice). |
| **Patch** (0.1.0 → 0.1.1) | Bugfix in runner/scorer/reporter/pattern eval. README/CHANGELOG/docs update that ships in the tarball. Dependency security bump. Internal refactor with identical observable behavior. Probe edits that don't change verdict semantics (typos, wording). |
| **None — skip release** | Changes entirely in files that don't ship: `CLAUDE.md`, `CRAFTS.md`, `PRD.md`, `PHASE_*.md`, `skill-map.md`, `openapi.yaml`, `.claude/**`, `.github/**`, `tests/**`, `*_audit.json`, `vitest.config.ts`, `eslint.config.js`. |

**Heuristic:** if `npm pack --dry-run` would include the changed file, a release decision is needed. If it wouldn't, the change is internal — just commit and move on.

State the chosen bump **and the reasoning** before executing. Example:
> "Patch bump 0.1.0 → 0.1.1: bugfix in `scorer.ts` for zero-weight categories. No public API change."

## 2. If no bump needed

```bash
git add <files>
git commit -m "<conventional message>"
git push
```

Done. Skip the rest of this skill.

## 3. If a bump is needed — execute the release

### 3a. Bump version

```bash
npm version <patch|minor|major> --no-git-tag-version
```

`--no-git-tag-version` because we'll commit + tag manually after the changelog entry.

### 3b. Update CHANGELOG.md

Append a new entry at the top:

```markdown
## v<NEW_VERSION> — <YYYY-MM-DD>

### Added
- <bullet>

### Changed
- <bullet>

### Fixed
- <bullet>
```

Omit empty subsections. Bullets describe **user-visible behavior**, not implementation. If CHANGELOG.md doesn't exist, create it with a `# Changelog` header above the first entry.

### 3c. Validate before tagging

```bash
npm run build
npm run test:run
```

If either fails: **revert the version bump**, fix the underlying issue, restart this skill. Do not tag a release that doesn't build/test clean.

### 3d. Commit, tag, push

```bash
git add package.json package-lock.json CHANGELOG.md <other staged files>
git commit -m "Release v<NEW_VERSION>

<one-paragraph summary of user-visible changes>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git tag v<NEW_VERSION>
git push
git push --tags
```

### 3e. Publish to npm

```bash
npm publish --access public
```

Notes:
- `prepublishOnly` re-runs build + tests as a final guardrail.
- If 2FA is enabled, npm will prompt for an OTP — **the user must enter this interactively**, never bypass.
- If the publish fails after the git tag is pushed, **don't delete the tag**. Diagnose the cause (auth, name collision, validation error). Fix-forward with a patch bump rather than rewriting history.

### 3f. Verify

```bash
npm view prompt-spear version          # should match NEW_VERSION
npx prompt-spear@<NEW_VERSION> --demo hardened   # smoke test from registry
```

## Guardrails

- **Never** `git commit --amend` a published release commit
- **Never** force-push to `main` or rewrite published tags
- **Never** use `--no-verify` on a release commit
- **Never** `npm unpublish` a version that's been live longer than 72 hours (npm policy + users may already depend on it)
- If you discover a bug in a freshly published version, prefer a follow-up patch over unpublishing

## Phase-specific guidance

Phase 2 will land changes that together warrant a single **0.2.0 minor bump** when the phase ships:

- New `evaluator` field on `Probe` type + tagged existing probes (additive)
- 8–12 new `'judge'`-evaluator probes
- `--ignore-judge` flag (additive)
- Judge client integration
- JSON schema fields: `evaluated_count`, `total_count`, `skipped[]` (additive)
- Exit code 3 for degraded runs (additive)
- Partial reveal + CTA in pretty output for free-tier users

During Phase 2 development, individual PRs that merge to `main` are typically patch-level (work-in-progress is invisible to npm consumers) **unless** they expose new user-facing surface area. Cumulative phase release happens once the trackers (#12 CLI, #4 web) are closed.
