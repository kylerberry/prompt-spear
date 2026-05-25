/**
 * Tests for the CLI wiring (`run`).
 *
 * `run(argv)` is the testable core: it parses flags, builds the adapter,
 * runs the audit, prints the report, and *returns* the exit code instead of
 * calling `process.exit`. The true entry point (only reached when the module
 * is executed directly) is the one place that calls `process.exit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync, readFileSync } from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, writeFileSync: vi.fn(), readFileSync: vi.fn() };
});

import { run, readPackageVersion, isMainModule } from './cli.js';
import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
import type { AuditReport } from './types.js';

const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReadFileSync = vi.mocked(readFileSync);

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
    mockedReadFileSync.mockReset();
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

  it('writes an audit JSON file after each run', async () => {
    await run(['--demo', 'hardened', '--runs-per-probe', '1']);
    expect(mockedWriteFileSync).toHaveBeenCalledOnce();
    const [filename, content] = mockedWriteFileSync.mock.calls[0] as [string, string];
    expect(filename).toMatch(/_audit\.json$/);
    const report = JSON.parse(content) as AuditReport;
    expect(typeof report.score).toBe('number');
  });

  it('uses --request-template file for the request body when provided', async () => {
    const template = '{"message":"{{prompt}}","sessionId":"test"}';
    mockedReadFileSync.mockReturnValue(template);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ response: 'I cannot help with that.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const code = await run([
      '--endpoint', 'https://example.test/api/chat',
      '--request-template', 'payload.json',
      '--runs-per-probe', '1',
      '--key', 'test-key',
    ]);

    expect(mockedReadFileSync).toHaveBeenCalledWith('payload.json', 'utf8');
    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.sessionId).toBe('test');
    expect([0, 1]).toContain(code);
  });

  it('errors when --request-template file lacks {{prompt}}', async () => {
    mockedReadFileSync.mockReturnValue('{"message":"static"}');

    const code = await run([
      '--endpoint', 'https://example.test/api/chat',
      '--request-template', 'bad.json',
      '--key', 'test-key',
      '--runs-per-probe', '1',
    ]);

    expect(code).toBe(1);
    const message = stderr.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toMatch(/\{\{prompt\}\}/);
  });

  it('accepts --concurrency and --max-retries without errors', async () => {
    const code = await run([
      '--demo', 'hardened',
      '--runs-per-probe', '1',
      '--concurrency', '2',
      '--max-retries', '0',
    ]);
    expect(code).toBe(0);
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

describe('readPackageVersion', () => {
  afterEach(() => {
    mockedReadFileSync.mockReset();
  });

  it('returns the version from package.json', () => {
    mockedReadFileSync.mockReturnValue('{"version":"1.2.3"}');
    expect(readPackageVersion(new URL('file:///fake/package.json'))).toBe('1.2.3');
  });

  it('falls back to 0.0.0 when version field is missing', () => {
    mockedReadFileSync.mockReturnValue('{}');
    expect(readPackageVersion(new URL('file:///fake/package.json'))).toBe('0.0.0');
  });

  it('falls back to 0.0.0 when the file cannot be read', () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readPackageVersion(new URL('file:///missing/package.json'))).toBe('0.0.0');
  });
});

describe('isMainModule', () => {
  it('returns false when argv[1] is undefined', () => {
    expect(isMainModule(undefined, 'file:///irrelevant.js')).toBe(false);
  });

  it('returns false when realpath cannot resolve argv[1]', () => {
    expect(isMainModule('/no/such/file/anywhere', 'file:///irrelevant.js')).toBe(false);
  });

  it('returns true when argv[1] realpath matches the module URL', () => {
    const realSelf = realpathSync(process.execPath);
    expect(isMainModule(process.execPath, pathToFileURL(realSelf).href)).toBe(true);
  });

  it('returns false when argv[1] points to a different file than the module URL', () => {
    expect(isMainModule(process.execPath, 'file:///some/other/path.js')).toBe(false);
  });
});
