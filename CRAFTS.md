# CRAFTS — Development Workflow

Follow CRAFTS for every non-trivial task.

**Full flow** — business logic, multiple files, domain boundaries: C → R → A → F → T → S
**Lite flow** — config, scaffolding, single-file fixes: R → S only
**Escalate** — start Lite, switch to Full if complexity grows

## C — Conceptualize

Use `/plan`. Produce scope, test cases, implementation plan, and risks. Stop for human review before writing any code.

## R — Render (Test-Drive)

TDD is mandatory. No implementation before a failing test.

1. **Red** — write the failing test from the plan. If you can't write it, return to Conceptualize.
2. **Green** — write the minimum implementation to pass. No more.
3. **Refactor** — clean up without breaking green. Repeat for each test case.

Run lint, type checks, and format when all tests pass.

## A — Assess

Run `/codex:review`, then `/simplify` on the diff. Address quality, reuse, and efficiency issues before moving on.

## F — Fix

Address blocking issues from Assess. Re-run quality checks. Disagree with a finding? Document why instead of blindly fixing.

## T — Tighten

Run the `security-scanning-security-hardening` skill on the diff. Fix all findings before proceeding.

## S — Sharpen

Commit and push. Update the relevant domain `CLAUDE.md` with lessons learned: patterns established, gotchas discovered, conventions set during this task.
