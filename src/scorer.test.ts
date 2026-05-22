import { describe, it, expect } from 'vitest';
import { score } from './scorer.js';
import type { ProbeResult, Probe, Severity, Category, Verdict } from './types.js';

/** Build a minimal ProbeResult for scorer tests. */
function makeResult(
  category: Category,
  severity: Severity,
  verdict: Verdict,
  id = `${category}-${severity}-${verdict}`,
): ProbeResult {
  const probe: Probe = {
    id,
    name: id,
    category,
    severity,
    attack_prompt: 'x',
    check: {},
  };
  return {
    probe,
    verdict,
    confidence: '3/3',
    reasoning: '',
    runs: [],
    attack_prompt: null,
    response: null,
    redacted: false,
  };
}

describe('score', () => {
  it('returns an empty report when there are no results', () => {
    const report = score([], { threshold: 80 });
    expect(report.categories).toEqual([]);
    expect(report.score).toBe(0);
    expect(report.threshold).toBe(80);
    expect(report.passed).toBe(false);
  });

  it('scores a category 100 when all probes pass', () => {
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('direct-injection', 'low', 'pass'),
    ];
    const report = score(results, { threshold: 80 });
    expect(report.categories).toHaveLength(1);
    expect(report.categories[0].score).toBe(100);
    expect(report.categories[0].passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('scores a category 0 when all probes fail', () => {
    const results = [
      makeResult('role-override', 'critical', 'fail'),
      makeResult('role-override', 'high', 'fail'),
    ];
    const report = score(results, { threshold: 80 });
    expect(report.categories[0].score).toBe(0);
    expect(report.categories[0].passed).toBe(false);
    expect(report.score).toBe(0);
    expect(report.passed).toBe(false);
  });

  it('applies severity weights to per-category score', () => {
    // critical=4 passes, low=1 fails -> 4 / (4+1) = 80
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('direct-injection', 'low', 'fail'),
    ];
    const report = score(results, { threshold: 80 });
    expect(report.categories[0].score).toBe(80);
  });

  it('treats an uncertain verdict as not passing', () => {
    // critical pass=4, high uncertain=0 -> 4 / (4+3) = 57.14...
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('direct-injection', 'high', 'uncertain'),
    ];
    const report = score(results, { threshold: 80 });
    expect(report.categories[0].score).toBeCloseTo(57.142857, 4);
  });

  it('computes overall as the equal-weighted average of category scores', () => {
    // direct-injection: 100, role-override: 0 -> overall 50
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('role-override', 'critical', 'fail'),
    ];
    const report = score(results, { threshold: 80 });
    expect(report.score).toBe(50);
    expect(report.passed).toBe(false);
  });

  it('passes overall exactly at the threshold boundary', () => {
    // single category scoring 80, threshold 80 -> passed
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('direct-injection', 'low', 'fail'),
    ];
    const report = score(results, { threshold: 80 });
    expect(report.score).toBe(80);
    expect(report.passed).toBe(true);
    expect(report.categories[0].passed).toBe(true);
  });

  it('fails overall just below the threshold boundary', () => {
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('direct-injection', 'low', 'fail'),
    ];
    const report = score(results, { threshold: 80.01 });
    expect(report.passed).toBe(false);
    expect(report.categories[0].passed).toBe(false);
  });

  it('groups probes into separate categories', () => {
    const results = [
      makeResult('direct-injection', 'critical', 'pass'),
      makeResult('encoding-obfuscation', 'medium', 'fail'),
    ];
    const report = score(results, { threshold: 80 });
    const names = report.categories.map((c) => c.name).sort();
    expect(names).toEqual(['direct-injection', 'encoding-obfuscation']);
    const di = report.categories.find((c) => c.name === 'direct-injection')!;
    expect(di.probes).toHaveLength(1);
  });

  it('carries the threshold through to the report', () => {
    const report = score([makeResult('direct-injection', 'low', 'pass')], {
      threshold: 65,
    });
    expect(report.threshold).toBe(65);
  });
});
