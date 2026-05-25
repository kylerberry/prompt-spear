/**
 * Regression test for the bin-shim symlink bug.
 *
 * v0.1.0 and v0.1.1 shipped with an entry-point guard that compared
 * `import.meta.url` against `file://${process.argv[1]}` as raw strings.
 * When npm/npx installs the package, the bin shim is a symlink — so
 * `process.argv[1]` is the symlink path while `import.meta.url` is the
 * realpath. Strings didn't match, the CLI silently exited 0 with no output,
 * and every existing test passed because they invoked `run()` directly
 * instead of running the built binary.
 *
 * This test invokes the built `dist/cli.js` via a symlink and asserts that
 * the entry point actually fires. Catches the bug at its real surface area.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, symlinkSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const builtCli = resolve(__dirname, '..', '..', 'dist', 'cli.js');
const pkgPath = resolve(__dirname, '..', '..', 'package.json');

describe('bin entry point (symlink invocation)', () => {
  beforeAll(() => {
    if (!existsSync(builtCli)) {
      throw new Error(
        `dist/cli.js missing — run "npm run build" before this test. ` +
        `Expected at ${builtCli}`,
      );
    }
  });

  it('produces output when invoked via a symlink (simulates npm bin shim)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'prompt-spear-bin-test-'));
    const symlinkPath = join(tmp, 'prompt-spear');
    symlinkSync(builtCli, symlinkPath);

    try {
      const stdout = execFileSync(symlinkPath, ['--demo', 'hardened'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // If the entry guard is broken, stdout is empty and exit is 0.
      // A real run prints the pretty report (which includes "Overall Score").
      expect(stdout.length, 'symlink-invoked binary should produce output').toBeGreaterThan(0);
      // Hardened demo runs at least one probe — any per-probe verdict line proves the pipeline ran.
      expect(stdout).toMatch(/PASS|FAIL/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30000);

  it('produces output when invoked directly via node', () => {
    const stdout = execFileSync(process.execPath, [builtCli, '--demo', 'hardened'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toMatch(/PASS|FAIL/);
  }, 30000);

  it('--version prints the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    const stdout = execFileSync(process.execPath, [builtCli, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(stdout.trim(), 'CLI --version should equal package.json version').toBe(pkg.version);
  }, 10000);
});
