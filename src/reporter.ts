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

import type { AuditReport, ProbeResult } from './types.js';

/** Supported output formats. `markdown` is deferred to issue #16. */
export type OutputFormat = 'json' | 'pretty';

/**
 * Map a report's pass/fail gate to a process exit code.
 *
 * Pure function — returns 0 when the report passed, 1 when it failed.
 * The CLI wires this to `process.exit`; the reporter never exits itself.
 */
export function exitCode(report: AuditReport): number {
  return report.passed ? 0 : 1;
}

// TODO: Re-enable partial reveal once payment/tier detection is in place.
// Previous behavior: first 3 probes unredacted, remainder redacted (attack_prompt/response nulled).
// Skipping until we have a real free-vs-paid distinction.
export function applyPartialReveal(report: AuditReport): AuditReport {
  return report;
}

/** Render a single probe result as indented terminal lines. */
function formatProbe(probe: ProbeResult): string {
  const mark = probe.verdict === 'pass' ? '✓' : probe.verdict === 'fail' ? '✗' : '?';
  return `    ${mark} ${probe.probe.name} — ${probe.verdict} (${probe.confidence})`;
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
