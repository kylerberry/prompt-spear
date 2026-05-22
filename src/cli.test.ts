/**
 * Tests for the CLI wiring (`run`).
 *
 * `run(argv)` is the testable core: it parses flags, builds the adapter,
 * runs the audit, prints the report, and *returns* the exit code instead of
 * calling `process.exit`. The true entry point (only reached when the module
 * is executed directly) is the one place that calls `process.exit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './cli.js';
import type { AuditReport } from './types.js';

/** Capture stdout written during a `run` call. */
function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => {
      chunks.push(args.map(String).join(' '));
    });
  return {
    output: () => chunks.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

describe('run', () => {
  let stdout: ReturnType<typeof captureStdout>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = captureStdout();
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stdout.restore();
    stderr.mockRestore();
    delete process.env.ENDPOINT_API_KEY;
    vi.restoreAllMocks();
  });

  it('exits 1 for the vulnerable demo target', async () => {
    const code = await run(['--demo', 'vulnerable', '--runs-per-probe', '1']);
    expect(code).toBe(1);
  });

  it('exits 0 for the hardened demo target', async () => {
    const code = await run(['--demo', 'hardened', '--runs-per-probe', '1']);
    expect(code).toBe(0);
  });

  it('errors and exits 1 when --endpoint is missing and --demo is absent', async () => {
    const code = await run(['--runs-per-probe', '1']);
    expect(code).toBe(1);
    const message = stderr.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toMatch(/--endpoint/);
  });

  it('produces valid AuditReport JSON with --output json', async () => {
    const code = await run([
      '--demo',
      'hardened',
      '--runs-per-probe',
      '1',
      '--output',
      'json',
    ]);
    expect(code).toBe(0);

    const report = JSON.parse(stdout.output()) as AuditReport;
    expect(typeof report.passed).toBe('boolean');
    expect(typeof report.score).toBe('number');
    expect(typeof report.threshold).toBe('number');
    expect(Array.isArray(report.categories)).toBe(true);
    for (const category of report.categories) {
      expect(typeof category.name).toBe('string');
      expect(typeof category.score).toBe('number');
      expect(typeof category.passed).toBe('boolean');
      expect(Array.isArray(category.probes)).toBe(true);
    }
  });

  it('filters probes to the named categories only', async () => {
    const code = await run([
      '--demo',
      'vulnerable',
      '--runs-per-probe',
      '1',
      '--categories',
      'role-override',
      '--output',
      'json',
    ]);
    expect([0, 1]).toContain(code);

    const report = JSON.parse(stdout.output()) as AuditReport;
    expect(report.categories.length).toBe(1);
    expect(report.categories[0]!.name).toBe('role-override');
  });

  it('rejects an unknown category with a clear error', async () => {
    const code = await run([
      '--demo',
      'vulnerable',
      '--runs-per-probe',
      '1',
      '--categories',
      'not-a-category',
    ]);
    expect(code).toBe(1);
    const message = stderr.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toMatch(/category/i);
  });

  it('honours --min-score for the pass/fail gate', async () => {
    // An impossible threshold makes even the hardened target fail.
    const code = await run([
      '--demo',
      'hardened',
      '--runs-per-probe',
      '1',
      '--min-score',
      '101',
    ]);
    expect(code).toBe(1);
  });

  it('falls back to ENDPOINT_API_KEY when --key is omitted', async () => {
    process.env.ENDPOINT_API_KEY = 'env-secret-key';
    const seen: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        const headers = new Headers(init?.headers);
        seen.push(headers.get('authorization') ?? '');
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'I cannot help with that.' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

    const code = await run([
      '--endpoint',
      'https://example.test/v1/chat/completions',
      '--runs-per-probe',
      '1',
    ]);

    expect(fetchSpy).toHaveBeenCalled();
    expect(seen.every((h) => h === 'Bearer env-secret-key')).toBe(true);
    expect([0, 1]).toContain(code);
  });

  it('rejects an unknown --output format', async () => {
    const code = await run([
      '--demo',
      'hardened',
      '--runs-per-probe',
      '1',
      '--output',
      'xml',
    ]);
    expect(code).toBe(1);
    const message = stderr.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toMatch(/output/i);
  });
});
