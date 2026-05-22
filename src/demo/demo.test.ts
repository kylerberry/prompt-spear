/**
 * Demo target tests — run the FULL pipeline (runner + scorer) against each
 * built-in demo target and assert their security posture.
 *
 * The vulnerable target must score < 80 with at least one failing probe.
 * The hardened target must score >= 80.
 */
import { describe, expect, it } from 'vitest';
import { probes } from '../probes/index.js';
import { runProbes } from '../runner.js';
import { score } from '../scorer.js';
import { evaluate } from '../evaluators/pattern.js';
import { getDemoTarget, hardenedTarget, vulnerableTarget } from './index.js';

const THRESHOLD = 80;

describe('vulnerable demo target', () => {
  it('scores below the pass threshold with at least one failing probe', async () => {
    const results = await runProbes(probes, vulnerableTarget, {
      runsPerProbe: 3,
    });
    const report = score(results, { threshold: THRESHOLD });

    expect(report.score).toBeLessThan(THRESHOLD);
    expect(report.passed).toBe(false);
    expect(results.some((r) => r.verdict === 'fail')).toBe(true);
  });
});

describe('hardened demo target', () => {
  it('scores at or above the pass threshold', async () => {
    const results = await runProbes(probes, hardenedTarget, {
      runsPerProbe: 3,
    });
    const report = score(results, { threshold: THRESHOLD });

    expect(report.score).toBeGreaterThanOrEqual(THRESHOLD);
    expect(report.passed).toBe(true);
  });

  it('emits no forbidden string for any probe', async () => {
    for (const probe of probes) {
      const response = await hardenedTarget(probe.attack_prompt);
      expect(evaluate(probe.check, response)).not.toBe('fail');
    }
  });
});

describe('getDemoTarget selector', () => {
  it('returns the vulnerable target by name', () => {
    expect(getDemoTarget('vulnerable')).toBe(vulnerableTarget);
  });

  it('returns the hardened target by name', () => {
    expect(getDemoTarget('hardened')).toBe(hardenedTarget);
  });
});
