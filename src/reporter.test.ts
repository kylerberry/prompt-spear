import { describe, it, expect } from 'vitest';
import { formatReport, exitCode, applyPartialReveal } from './reporter.js';
import type {
  AuditReport,
  CategoryResult,
  ProbeResult,
  Probe,
  Category,
  Severity,
  Verdict,
} from './types.js';

/** Build a minimal ProbeResult for reporter tests. */
function makeResult(
  id: string,
  verdict: Verdict = 'pass',
  category: Category = 'direct-injection',
  severity: Severity = 'high',
): ProbeResult {
  const probe: Probe = {
    id,
    name: `probe ${id}`,
    category,
    severity,
    attack_prompt: `attack-${id}`,
    check: {},
  };
  return {
    probe,
    verdict,
    confidence: '3/3',
    reasoning: `reasoning-${id}`,
    runs: [],
    attack_prompt: `attack-${id}`,
    response: `response-${id}`,
    redacted: false,
  };
}

/** Build an AuditReport from a flat list of probe results. */
function makeReport(
  probes: ProbeResult[],
  score = 90,
  threshold = 80,
): AuditReport {
  const category: CategoryResult = {
    name: 'direct-injection',
    score,
    passed: score >= threshold,
    probes,
  };
  return {
    passed: score >= threshold,
    score,
    threshold,
    categories: [category],
  };
}

describe('exitCode', () => {
  it('returns 0 when the report passed', () => {
    expect(exitCode(makeReport([makeResult('a')], 90))).toBe(0);
  });

  it('returns 1 when the report failed', () => {
    expect(exitCode(makeReport([makeResult('a', 'fail')], 50))).toBe(1);
  });

  it('returns 0 at the threshold boundary (score === threshold)', () => {
    const report = makeReport([makeResult('a')], 80, 80);
    expect(report.passed).toBe(true);
    expect(exitCode(report)).toBe(0);
  });

  it('returns 1 just below the threshold boundary', () => {
    expect(exitCode(makeReport([makeResult('a')], 79.9, 80))).toBe(1);
  });
});

describe('applyPartialReveal', () => {
  it('does not redact when there are 2 probes', () => {
    const report = applyPartialReveal(
      makeReport([makeResult('a'), makeResult('b')]),
    );
    const probes = report.categories[0].probes;
    expect(probes.every((p) => !p.redacted)).toBe(true);
    expect(probes[0].attack_prompt).toBe('attack-a');
    expect(probes[0].response).toBe('response-a');
  });

  // TODO: Update these when partial reveal is re-enabled for paid vs. free tiers.
  it('does not redact any probes (partial reveal currently disabled)', () => {
    const report = applyPartialReveal(
      makeReport([
        makeResult('a'),
        makeResult('b'),
        makeResult('c'),
        makeResult('d'),
      ]),
    );
    const probes = report.categories[0].probes;
    expect(probes.every((p) => !p.redacted)).toBe(true);
    expect(probes[3].attack_prompt).toBe('attack-d');
    expect(probes[3].response).toBe('response-d');
  });

  it('returns the report unchanged across multiple categories', () => {
    const report: AuditReport = {
      passed: true,
      score: 90,
      threshold: 80,
      categories: [
        {
          name: 'direct-injection',
          score: 90,
          passed: true,
          probes: [makeResult('a'), makeResult('b')],
        },
        {
          name: 'role-override',
          score: 90,
          passed: true,
          probes: [makeResult('c'), makeResult('d')],
        },
      ],
    };
    const revealed = applyPartialReveal(report);
    expect(revealed.categories[0].probes.every((p) => !p.redacted)).toBe(true);
    expect(revealed.categories[1].probes.every((p) => !p.redacted)).toBe(true);
  });

  it('does not mutate the input report', () => {
    const original = makeReport([
      makeResult('a'),
      makeResult('b'),
      makeResult('c'),
      makeResult('d'),
    ]);
    applyPartialReveal(original);
    expect(original.categories[0].probes[3].redacted).toBe(false);
    expect(original.categories[0].probes[3].attack_prompt).toBe('attack-d');
  });
});

describe('formatReport — json', () => {
  it('produces valid JSON parseable back to an AuditReport', () => {
    const report = makeReport([makeResult('a')]);
    const out = formatReport(report, 'json');
    const parsed = JSON.parse(out) as AuditReport;
    expect(parsed.score).toBe(report.score);
    expect(parsed.passed).toBe(report.passed);
    expect(parsed.threshold).toBe(report.threshold);
    expect(parsed.categories).toHaveLength(1);
  });

  it('json output matches the AuditReport schema exactly (no extra keys)', () => {
    const report = makeReport([makeResult('a')]);
    const parsed = JSON.parse(formatReport(report, 'json')) as AuditReport;
    expect(Object.keys(parsed).sort()).toEqual(
      ['categories', 'passed', 'score', 'threshold'].sort(),
    );
  });

  // TODO: Update when partial reveal is re-enabled for paid vs. free tiers.
  it('json output includes full probe data (partial reveal currently disabled)', () => {
    const report = makeReport([
      makeResult('a'),
      makeResult('b'),
      makeResult('c'),
      makeResult('d'),
    ]);
    const parsed = JSON.parse(formatReport(report, 'json')) as AuditReport;
    expect(parsed.categories[0].probes[3].redacted).toBe(false);
    expect(parsed.categories[0].probes[3].attack_prompt).toBe('attack-d');
  });
});

describe('formatReport — pretty', () => {
  it('includes the overall score and PASS/FAIL gate', () => {
    const out = formatReport(makeReport([makeResult('a')], 90), 'pretty');
    expect(out).toContain('90');
    expect(out).toMatch(/PASS/i);
  });

  it('shows FAIL when the report did not pass', () => {
    const out = formatReport(
      makeReport([makeResult('a', 'fail')], 40),
      'pretty',
    );
    expect(out).toMatch(/FAIL/i);
  });

  it('includes per-category score', () => {
    const out = formatReport(makeReport([makeResult('a')], 90), 'pretty');
    expect(out).toContain('direct-injection');
  });

  it('includes per-probe verdict and confidence', () => {
    const out = formatReport(makeReport([makeResult('a')], 90), 'pretty');
    expect(out).toContain('probe a');
    expect(out).toContain('3/3');
  });

  it('does not include attack prompts or responses in pretty output', () => {
    const out = formatReport(makeReport([makeResult('a')], 90), 'pretty');
    expect(out).not.toContain('attack_prompt');
    expect(out).not.toContain('reasoning-a');
  });

  it('omits the upgrade CTA from pretty output', () => {
    const out = formatReport(makeReport([makeResult('a')], 90), 'pretty');
    expect(out).not.toMatch(/prompt-spear\.dev/);
  });

  it('omits the upgrade CTA when there are 0 probes', () => {
    const out = formatReport(makeReport([], 0), 'pretty');
    expect(out).not.toMatch(/prompt-spear\.dev/);
  });
});
