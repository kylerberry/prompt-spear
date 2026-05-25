---
name: cli-release
description: Use ONLY when the user explicitly asks to cut a release, bump the version, tag, or publish to npm. Phrases that trigger this skill — "ship it", "publish", "release v...", "bump version", "tag a release". DO NOT auto-run on normal commits. Versioning is user-initiated, not commit-initiated.
---

# CLI release procedure

This skill runs **only when the user asks for a release.** Normal commits to `main` do NOT trigger this — they just `git commit && git push`. Version bumps, tags, and npm publishes happen on explicit request only.

## When NOT to use this skill

- Regular commit to `main` — just commit and push normally
- WIP changes that aren't ready to ship
- Internal refactors, doc edits, CI tweaks, CHANGELOG-only updates accumulating under `## Unreleased`
- Anything that wasn't preceded by a user message asking to release

If you find yourself reaching for this skill because "the diff looks like it warrants a bump," **stop**. Wait for the user to ask. Optionally, mention in your response that there are unreleased changes piling up in `## Unreleased` — but don't act.

## When to use this skill

The user says some variant of:
- "publish"
- "ship it" / "ship v0.1.3"
- "cut a release"
- "bump the version"
- "tag and publish"
- "release this"

## Procedure

### 0. Preflight

```bash
cd /Users/kylerberry/Projects/prompt-spear/cli
git rev-parse --abbrev-ref HEAD       # must print: main
git status --short                     # working tree should be clean (or only have CHANGELOG/version tweaks staged)
git fetch --tags
git describe --tags --abbrev=0         # last shipped version (e.g. v0.1.0)
npm view prompt-spear version          # what's actually live on npm
```

If branch ≠ `main`, **stop** — this skill only runs on main.
If `npm view` and `git describe` disagree, surface the mismatch and ask the user before proceeding.

### 1. Confirm the bump type with the user

Show them the unreleased changes:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
cat CHANGELOG.md   # show the ## Unreleased section
```

Then propose a bump level + brief reasoning. **Get explicit user confirmation before bumping.**

Classification reference (use to inform the proposal, not to act unilaterally):

| Bump | Trigger (any one is enough) |
|---|---|
| **Major** | Removed/renamed a CLI flag. Repurposed an exit code. Changed shape of an existing JSON output field. Bumped required Node `engines`. |
| **Minor** | Added a CLI flag. Added a new field to JSON output (additive). New attack category. New `evaluator` mode. New probe class that materially changes audit coverage. Adding a new exit code. |
| **Patch** | Bugfix in runner/scorer/reporter/pattern eval. README content changes. Dependency security bump. Internal refactor with identical observable behavior. Probe edits that don't change verdict semantics. New probes that extend existing categories. |

Cosmetic-only changes (README badge, hero image, formatting) **do not require a release of their own** — fold them into the next functional release via the `## Unreleased` section.

### 2. Bump version

```bash
npm version <patch|minor|major> --no-git-tag-version
```

`--no-git-tag-version` because we tag manually after the CHANGELOG update.

### 3. Update CHANGELOG.md

Promote the `## Unreleased` section to the new version, dated today:

```markdown
## v<NEW_VERSION> — <YYYY-MM-DD>

### Added
- <items from Unreleased>

### Changed
- ...

### Fixed
- ...
```

Then add a fresh empty `## Unreleased` section at the top:

```markdown
## Unreleased

## v<NEW_VERSION> — ...
```

### 4. Validate before tagging

```bash
npm run build
npm run test:run
```

If either fails: **revert the version bump**, fix the underlying issue, restart this skill. Do not tag a release that doesn't build/test clean.

### 5. Commit, tag, push

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release v<NEW_VERSION>

<one-paragraph summary of user-visible changes>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git tag v<NEW_VERSION>
git push
git push origin v<NEW_VERSION>
```

### 6. Publish to npm

```bash
npm publish --access public
```

Notes:
- `prepublishOnly` re-runs build + tests as a final guardrail.
- 2FA: if enabled, npm will prompt for an OTP — **the user enters this interactively**, never bypass.
- If publish fails *after* the git tag is pushed, **don't delete the tag**. Diagnose. Fix-forward with a patch bump rather than rewriting history.

### 7. Verify

```bash
npm view prompt-spear version          # should match NEW_VERSION
npx prompt-spear@<NEW_VERSION> --demo hardened   # smoke test from registry
```

## Tracking unreleased work between releases

Between releases, keep CHANGELOG.md's `## Unreleased` section accurate. When committing changes that *would* eventually warrant a release entry:

- Add a bullet under `## Unreleased`
- Do NOT bump `package.json` version
- Do NOT tag
- Commit and push normally

This makes the next release a clean "promote Unreleased to vX.Y.Z" step.

## Guardrails

- **Never** auto-trigger this skill from a commit
- **Never** `git commit --amend` a published release commit
- **Never** force-push to `main` or rewrite published tags
- **Never** use `--no-verify` on a release commit
- **Never** `npm unpublish` a version that's been live longer than 72 hours

## What if the user wants to walk back a tag?

If a tag was created but the version was never `npm publish`ed, the tag can be safely removed:

```bash
git tag -d v<VERSION>                          # local
git push --delete origin v<VERSION>            # remote
```

Then reset `package.json` to the last published version and re-stage unreleased items under `## Unreleased`.

Never delete a tag for a version that has been published to npm — that creates a permanent mismatch between npm history and git history.
