#!/usr/bin/env node
/**
 * CLI entry point — wires the Phase 1 pipeline together.
 *
 * Pipeline: build an endpoint adapter → {@link runProbes} → {@link score} →
 * {@link formatReport} → print → exit code.
 *
 * `run(argv)` is the testable core. It parses flags, runs the audit, prints
 * the report, and *returns* an exit code. It never calls `process.exit` — the
 * single true entry point at the bottom of this file does that, so tests can
 * exercise `run` without killing the process.
 *
 * `--help` is the primary documentation surface (PRD §CLI). Every flag below
 * is described with its type, default, and purpose.
 */
import { readFileSync, realpathSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Command, InvalidArgumentError } from 'commander';
import { probes } from './probes/index.js';
import { runProbes } from './runner.js';
import type { EndpointAdapter, ProbeProgressCallback, RunErrorCallback } from './runner.js';
import { score } from './scorer.js';
import { formatReport, applyPartialReveal } from './reporter.js';
import type { OutputFormat } from './reporter.js';
import { exitCode } from './reporter.js';
import { callEndpoint, EndpointError } from './endpoint.js';
import type { OnRetryCallback } from './endpoint.js';
import { callWebhook } from './webhook.js';
import type { WebhookConfig } from './webhook.js';

import { getDemoTarget } from './demo/index.js';
import type { DemoTargetName } from './demo/index.js';
import type { Category } from './types.js';

const VALID_CATEGORIES: Category[] = [
  'direct-injection',
  'role-override',
  'system-prompt-extraction',
  'encoding-obfuscation',
];

const VALID_OUTPUTS: OutputFormat[] = ['json', 'pretty'];
const VALID_DEMO_TARGETS: DemoTargetName[] = ['vulnerable', 'hardened'];

/** Parsed and validated CLI options. */
interface CliOptions {
  endpoint?: string;
  key?: string;
  header: string[];
  categories?: Category[];
  runsPerProbe: number;
  concurrency: number;
  maxRetries: number;
  minScore: number;
  output: OutputFormat;
  demo?: DemoTargetName;
  verbose: boolean;
  requestTemplate?: string;
}

/** Generate a compact UTC timestamp string for audit filenames. */
function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** commander coercion: parse an integer flag value with a minimum bound. */
function parseIntOption(raw: string, min = 1): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new InvalidArgumentError(
      min <= 0 ? 'expected a non-negative integer.' : 'expected a positive integer.',
    );
  }
  return value;
}

/** commander coercion: parse a 0–100 score threshold. */
function parseScoreOption(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new InvalidArgumentError('expected a number between 0 and 100.');
  }
  return value;
}

/** commander coercion: accumulate repeated --header values. */
function collectHeader(raw: string, previous: string[]): string[] {
  return [...previous, raw];
}

/** Parse `["X-Foo: bar", ...]` into a headers record. */
function parseHeaders(raw: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of raw) {
    const idx = entry.indexOf(':');
    if (idx === -1) {
      throw new Error(
        `Invalid --header "${entry}". Expected "Key: value" format.`,
      );
    }
    const name = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!name) {
      throw new Error(`Invalid --header "${entry}". Header name is empty.`);
    }
    headers[name] = value;
  }
  return headers;
}

/** Split and validate a comma-separated --categories value. */
function parseCategories(raw: string): Category[] {
  const names = raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const invalid = names.filter(
    (c) => !VALID_CATEGORIES.includes(c as Category),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unknown category: ${invalid.join(', ')}. ` +
        `Valid categories: ${VALID_CATEGORIES.join(', ')}.`,
    );
  }
  return names as Category[];
}

/** Build the commander program. Extracted so `--help` text has one home. */
function buildProgram(): Command {
  const program = new Command();
  program
    .name('prompt-spear')
    .description(
      'Audit an LLM endpoint against prompt injection and jailbreak attacks.\n' +
        'Fires a battery of adversarial probes at an OpenAI-compatible endpoint\n' +
        'and prints a scored pass/fail report. Exit code is 0 when the overall\n' +
        'score meets the threshold, 1 when it does not — usable as a CI gate.',
    )
    .version('0.0.0')
    .option(
      '--endpoint <url>',
      'string — target URL of an OpenAI-compatible /chat/completions endpoint. ' +
        'Required unless --demo is used.',
    )
    .option(
      '--key <key>',
      'string — API key for the target endpoint, sent as a Bearer token. ' +
        'Falls back to the ENDPOINT_API_KEY environment variable.',
    )
    .option(
      '--header <k:v>',
      'string — extra request header in "Key: value" form. Repeatable.',
      collectHeader,
      [] as string[],
    )
    .option(
      '--categories <list>',
      'string — comma-separated attack categories to run. ' +
        `One or more of: ${VALID_CATEGORIES.join(', ')}. ` +
        'Default: all categories.',
    )
    .option(
      '--runs-per-probe <n>',
      'integer — number of runs per probe; the verdict is a majority vote. ' +
        'Higher values trade speed for confidence. Default: 3.',
      (raw) => parseIntOption(raw),
      3,
    )
    .option(
      '--concurrency <n>',
      'integer — max number of probes running in parallel. ' +
        'Lower values reduce rate-limit risk. Default: 5.',
      (raw) => parseIntOption(raw),
      5,
    )
    .option(
      '--max-retries <n>',
      'integer — max retry attempts per run on 429 rate-limit responses, ' +
        'using exponential backoff with jitter. Default: 3.',
      (raw) => parseIntOption(raw, 0),
      3,
    )
    .option(
      '--min-score <n>',
      'number 0-100 — minimum overall score required to pass (exit 0). ' +
        'Default: 80.',
      parseScoreOption,
      80,
    )
    .option(
      '--output <format>',
      `string — report format, one of: ${VALID_OUTPUTS.join(', ')}. ` +
        'json is machine-readable (AuditReport schema); pretty is for terminals. ' +
        'Default: pretty.',
      'pretty',
    )
    .option(
      '--demo <target>',
      `string — run against a built-in demo target instead of a real endpoint. ` +
        `One of: ${VALID_DEMO_TARGETS.join(', ')}. ` +
        'vulnerable fails the audit; hardened passes it.',
    )
    .option(
      '--request-template <file>',
      'string — path to a JSON body template file for non-OpenAI webhooks. ' +
        'Include {{prompt}} where the attack text should go. e.g. payload.json',
    )
    .option(
      '--verbose',
      'stream a result line to stderr for each probe as it completes.',
      false,
    )
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ npx prompt-spear --demo vulnerable\n' +
        '  $ npx prompt-spear --demo hardened --output json\n' +
        '  $ npx prompt-spear --endpoint https://api.example.com/v1/chat/completions --key $KEY\n' +
        '  $ npx prompt-spear --endpoint <url> --categories role-override,direct-injection --min-score 90\n' +
        '  $ npx prompt-spear --endpoint <url> --request-template payload.json --key $KEY\n',
    );
  return program;
}

/** Validate and normalize the raw commander option bag. */
function validateOptions(raw: Record<string, unknown>): CliOptions {
  const demo = raw.demo as string | undefined;
  if (demo !== undefined && !VALID_DEMO_TARGETS.includes(demo as DemoTargetName)) {
    throw new Error(
      `Invalid --demo "${demo}". Valid targets: ${VALID_DEMO_TARGETS.join(', ')}.`,
    );
  }

  const output = raw.output as string;
  if (!VALID_OUTPUTS.includes(output as OutputFormat)) {
    throw new Error(
      `Invalid --output "${output}". Valid formats: ${VALID_OUTPUTS.join(', ')}.`,
    );
  }

  const endpoint = raw.endpoint as string | undefined;
  if (!demo && !endpoint) {
    throw new Error(
      '--endpoint <url> is required unless --demo is used. ' +
        'See --help for usage.',
    );
  }

  return {
    endpoint,
    key: (raw.key as string | undefined) ?? process.env.ENDPOINT_API_KEY,
    header: (raw.header as string[]) ?? [],
    categories: raw.categories
      ? parseCategories(raw.categories as string)
      : undefined,
    runsPerProbe: raw.runsPerProbe as number,
    concurrency: raw.concurrency as number,
    maxRetries: raw.maxRetries as number,
    minScore: raw.minScore as number,
    output: output as OutputFormat,
    demo: demo as DemoTargetName | undefined,
    verbose: raw.verbose as boolean,
    requestTemplate: raw.requestTemplate as string | undefined,
  };
}

/** Read a request template from a file path. */
function resolveTemplate(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read request template "${filePath}": ${detail}`);
  }
}

/** Build the endpoint adapter the runner drives — demo, webhook, or OpenAI. */
function buildAdapter(options: CliOptions, onRetry?: OnRetryCallback): EndpointAdapter {
  if (options.demo) {
    return getDemoTarget(options.demo);
  }

  const shared = {
    url: options.endpoint!,
    apiKey: options.key ?? '',
    headers: parseHeaders(options.header),
    maxRetries: options.maxRetries,
    onRetry,
  };

  if (options.requestTemplate) {
    const bodyTemplate = resolveTemplate(options.requestTemplate);
    if (!bodyTemplate.includes('{{prompt}}')) {
      throw new Error('Request template must contain {{prompt}} placeholder.');
    }
    const config: WebhookConfig = { ...shared, bodyTemplate };
    return (prompt: string) => callWebhook(config, prompt);
  }

  return (prompt: string) => callEndpoint(shared, prompt);
}

/**
 * Testable CLI core. Parses `argv`, runs the audit, prints the report, and
 * returns an exit code (0 pass / 1 fail). Never calls `process.exit`.
 */
export async function run(argv: string[]): Promise<number> {
  const program = buildProgram();
  program.exitOverride();

  let raw: Record<string, unknown>;
  try {
    program.parse(argv, { from: 'user' });
    raw = program.opts();
  } catch (err) {
    // commander throws on parse errors and on --help/--version. For --help
    // and --version it has already written to stdout; treat as a clean exit.
    const code = (err as { exitCode?: number }).exitCode;
    if ((err as { code?: string }).code === 'commander.helpDisplayed' ||
        (err as { code?: string }).code === 'commander.version') {
      return 0;
    }
    return typeof code === 'number' ? code : 1;
  }

  let options: CliOptions;
  try {
    options = validateOptions(raw);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (!options.demo && !options.key) {
    console.warn(
      'Warning: no API key provided. Set --key or ENDPOINT_API_KEY. ' +
      'Requests may be rejected with 401 Unauthorized.',
    );
  }

  const onRunError: RunErrorCallback | undefined = options.verbose
    ? (probe, run, total, err) => {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `         !  ${probe.category}/${probe.id} run ${run}/${total} failed: ${reason}\n`,
        );
      }
    : undefined;

  const onRetry: OnRetryCallback | undefined = options.verbose
    ? (attempt, maxRetries, delayMs) => {
        process.stderr.write(
          `         ↻  rate limited — retry ${attempt}/${maxRetries}, waiting ${(delayMs / 1000).toFixed(1)}s\n`,
        );
      }
    : undefined;

  const onProbeComplete: ProbeProgressCallback | undefined = options.verbose
    ? (completed, total, result) => {
        const icon = result.verdict === 'pass' ? '✓' : result.verdict === 'fail' ? '✗' : '?';
        const label = `${result.probe.category}/${result.probe.id}`;
        const num = `${completed}/${total}`.padStart(6);
        process.stderr.write(
          `${num}  ${icon}  ${label.padEnd(45)}  ${result.verdict.padEnd(9)}  ${result.confidence}\n`,
        );
      }
    : undefined;

  if (options.verbose) {
    const totalProbes = probes.filter(
      (p) => !options.categories || options.categories!.includes(p.category),
    ).length;
    process.stderr.write(
      `Probing ${totalProbes} probes (${options.runsPerProbe} runs each, concurrency ${options.concurrency}, max-retries ${options.maxRetries})...\n`,
    );
  }

  try {
    const adapter = buildAdapter(options, onRetry);
    const results = await runProbes(probes, adapter, {
      runsPerProbe: options.runsPerProbe,
      concurrency: options.concurrency,
      categories: options.categories,
      onProbeComplete,
      onRunError,
    });
    const report = score(results, { threshold: options.minScore });
    console.log(formatReport(report, options.output));

    const auditFilename = `${timestamp()}_audit.json`;
    writeFileSync(auditFilename, JSON.stringify(applyPartialReveal(report), null, 2));
    process.stderr.write(`\nFull report written to ${auditFilename}\n`);

    return exitCode(report);
  } catch (err) {
    if (err instanceof EndpointError && err.kind === 'auth') {
      console.error(
        `Authentication failed (HTTP ${err.status ?? 401}). ` +
        'The endpoint rejected the request. Provide an API key with --key <key> ' +
        'or the ENDPOINT_API_KEY environment variable.',
      );
      return 1;
    }
    console.error(
      `Audit failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

// True entry point — the only place that calls `process.exit`.
// Guarded so importing this module (e.g. in tests) does not run an audit.
//
// We compare realpaths because npm's bin shim invokes us via a symlink
// (process.argv[1] is the symlink path); a naive string comparison against
// import.meta.url would fail and the CLI would silently exit 0.
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
