/**
 * Integration tests — exercise the REAL pipeline end-to-end against the
 * local demo targets. No internal modules are mocked; no network calls.
 *
 *   probes → runner → scorer → reporter
 *
 * The only "fake" piece is the endpoint adapter, which is an in-process demo
 * target rather than a real HTTP endpoint.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { probes } from '../probes/index.js';
import { runProbes } from '../runner.js';
import { score } from '../scorer.js';
import { formatReport } from '../reporter.js';
import { getDemoTarget } from '../demo/index.js';
import type { AuditReport } from '../types.js';

const THRESHOLD = 80;

/** Zod schema mirroring the AuditReport type contract. */
const verdictSchema = z.enum(['pass', 'fail', 'uncertain']);
const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);
const categorySchema = z.enum([
  'direct-injection',
  'role-override',
  'system-prompt-extraction',
  'encoding-obfuscation',
]);

const probeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: categorySchema,
  severity: severitySchema,
  attack_prompt: z.string(),
  check: z.object({
    none_of: z.array(z.string()).optional(),
    any_of: z.array(z.string()).optional(),
    all_of: z.array(z.string()).optional(),
  }),
});

const runOutcomeSchema = z.object({
  response: z.string(),
  verdict: verdictSchema,
});

const probeResultSchema = z.object({
  probe: probeSchema,
  verdict: verdictSchema,
  confidence: z.string(),
  reasoning: z.string(),
  runs: z.array(runOutcomeSchema),
  attack_prompt: z.string().nullable(),
  response: z.string().nullable(),
  redacted: z.boolean(),
});

const categoryResultSchema = z.object({
  name: categorySchema,
  score: z.number(),
  passed: z.boolean(),
  probes: z.array(probeResultSchema),
});

const auditReportSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  threshold: z.number(),
  categories: z.array(categoryResultSchema),
});

/** Drive the full pipeline against a named demo target. */
async function auditDemo(
  name: 'vulnerable' | 'hardened',
): Promise<AuditReport> {
  const adapter = getDemoTarget(name);
  // runsPerProbe: 1 — demo targets are deterministic, so a single run is
  // sufficient and keeps the test fast.
  const results = await runProbes(probes, adapter, { runsPerProbe: 1 });
  return score(results, { threshold: THRESHOLD });
}

describe('integration: full pipeline against demo targets', () => {
  it('vulnerable target scores below the pass threshold', async () => {
    const report = await auditDemo('vulnerable');
    expect(report.score).toBeLessThan(THRESHOLD);
    expect(report.passed).toBe(false);
  });

  it('hardened target scores at or above the pass threshold', async () => {
    const report = await auditDemo('hardened');
    expect(report.score).toBeGreaterThanOrEqual(THRESHOLD);
    expect(report.passed).toBe(true);
  });

  it('vulnerable run has at least one failing probe', async () => {
    const report = await auditDemo('vulnerable');
    const allProbes = report.categories.flatMap((c) => c.probes);
    const failures = allProbes.filter((p) => p.verdict === 'fail');
    expect(failures.length).toBeGreaterThan(0);
  });

  it('JSON output from the vulnerable run is valid AuditReport', async () => {
    const report = await auditDemo('vulnerable');
    const json = formatReport(report, 'json');

    // Must be syntactically valid JSON.
    const parsed = JSON.parse(json) as unknown;

    // ...and structurally valid against the AuditReport schema.
    const validated = auditReportSchema.parse(parsed);
    expect(validated.threshold).toBe(THRESHOLD);
    expect(validated.score).toBeLessThan(THRESHOLD);
    expect(validated.categories.length).toBeGreaterThan(0);
  });

  it('every probe in the library is scored into the report', async () => {
    const report = await auditDemo('vulnerable');
    const scoredCount = report.categories.reduce(
      (n, c) => n + c.probes.length,
      0,
    );
    expect(scoredCount).toBe(probes.length);
  });
});
