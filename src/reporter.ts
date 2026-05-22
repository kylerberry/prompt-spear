/**
 * Reporter — pure formatting of an {@link AuditReport} for output.
 *
 * No business logic, no I/O. Three responsibilities:
 *  1. Partial reveal — first 3 probes (global index) keep their
 *     `attack_prompt`/`response`; probe index 3+ are redacted.
 *  2. Formatting — `json` (schema-exact) and `pretty` (terminal) output.
 *  3. Exit code — maps `report.passed` to a process exit code. The CLI
 *     (issue #10) is responsible for calling `process.exit`; the reporter
 *     only returns the number.
 *
 * Markdown output is deferred to issue #16. Full tier-aware redaction
 * enforcement (paid-key detection) is also #16 — this module applies the
 * unconditional first-3 rule so free-tier output is correct by default.
 */

import type { AuditReport, CategoryResult, ProbeResult } from './types.js';

/** Supported output formats. `markdown` is deferred to issue #16. */
export type OutputFormat = 'json' | 'pretty';

/** Number of probes revealed in full before redaction kicks in. */
const REVEAL_LIMIT = 3;

/**
 * Map a report's pass/fail gate to a process exit code.
 *
 * Pure function — returns 0 when the report passed, 1 when it failed.
 * The CLI wires this to `process.exit`; the reporter never exits itself.
 */
export function exitCode(report: AuditReport): number {
  return report.passed ? 0 : 1;
}

/**
 * Apply the partial-reveal rule to a report.
 *
 * Probes are indexed globally in category order. The first {@link REVEAL_LIMIT}
 * keep their `attack_prompt`/`response`; later probes get `redacted: true`
 * with both fields nulled. Returns a new report; the input is not mutated.
 */
export function applyPartialReveal(report: AuditReport): AuditReport {
  let globalIndex = 0;
  const categories: CategoryResult[] = report.categories.map((category) => ({
    ...category,
    probes: category.probes.map((probe) => {
      const redacted = globalIndex >= REVEAL_LIMIT;
      globalIndex += 1;
      if (!redacted) return { ...probe };
      return { ...probe, attack_prompt: null, response: null, redacted: true };
    }),
  }));
  return { ...report, categories };
}

/** Count redacted probes across all categories. */
function countRedacted(report: AuditReport): number {
  return report.categories.reduce(
    (sum, c) => sum + c.probes.filter((p) => p.redacted).length,
    0,
  );
}

/** Render a single probe result as indented terminal lines. */
function formatProbe(probe: ProbeResult): string {
  const mark = probe.verdict === 'pass' ? '✓' : probe.verdict === 'fail' ? '✗' : '?';
  const lines = [
    `    ${mark} ${probe.probe.name} — ${probe.verdict} (${probe.confidence})`,
  ];
  if (probe.reasoning) lines.push(`      ${probe.reasoning}`);
  if (probe.redacted) {
    lines.push('      [attack/response redacted — free tier]');
  } else {
    if (probe.attack_prompt) lines.push(`      attack:   ${probe.attack_prompt}`);
    if (probe.response) lines.push(`      response: ${probe.response}`);
  }
  return lines.join('\n');
}

/** Render the full report as a human-readable terminal string. */
function formatPretty(report: AuditReport): string {
  const gate = report.passed ? 'PASS' : 'FAIL';
  const score = Math.round(report.score * 10) / 10;
  const lines: string[] = [
    'prompt-spear audit report',
    '=========================',
    `Overall: ${score}/100 — ${gate} (threshold ${report.threshold})`,
    '',
  ];

  for (const category of report.categories) {
    const catScore = Math.round(category.score * 10) / 10;
    const catGate = category.passed ? 'PASS' : 'FAIL';
    lines.push(`  ${category.name}: ${catScore}/100 — ${catGate}`);
    for (const probe of category.probes) lines.push(formatProbe(probe));
    lines.push('');
  }

  const redacted = countRedacted(report);
  if (redacted > 0) {
    lines.push(
      `Upgrade to see all ${redacted} attack/response pairs at prompt-spear.dev`,
    );
  }

  return lines.join('\n');
}

/**
 * Format an audit report for output.
 *
 * Applies the partial-reveal rule, then renders the requested format.
 * `json` output is schema-exact (matches {@link AuditReport}).
 */
export function formatReport(
  report: AuditReport,
  format: OutputFormat,
): string {
  const revealed = applyPartialReveal(report);
  if (format === 'json') return JSON.stringify(revealed, null, 2);
  return formatPretty(revealed);
}
