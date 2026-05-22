/**
 * Scorer — pure functions that turn raw `ProbeResult[]` into a scored
 * `AuditReport`. No I/O, fully deterministic.
 *
 * Scoring model:
 *  - Severity weights: critical=4, high=3, medium=2, low=1.
 *  - Per-category score = (sum of passing probe weights /
 *    sum of all probe weights in category) × 100.
 *  - Overall score = equal-weighted average of category scores. Per issue #8,
 *    default category weights are equal; per-category weighting is configurable
 *    in a later issue.
 *  - A category (or the overall report) `passed` when its score is >= threshold.
 */

import type {
  AuditReport,
  Category,
  CategoryResult,
  ProbeResult,
  Severity,
} from './types.js';

/** Configuration for {@link score}. */
export interface ScoreConfig {
  /** Minimum score (0–100) required to pass. */
  threshold: number;
}

/** Severity → scoring weight. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** A probe passes only on an explicit `pass` verdict. */
function isPassing(result: ProbeResult): boolean {
  return result.verdict === 'pass';
}

/** Compute the weighted 0–100 score for one category's probe results. */
function categoryScore(probes: ProbeResult[]): number {
  const total = probes.reduce(
    (sum, p) => sum + SEVERITY_WEIGHT[p.probe.severity],
    0,
  );
  if (total === 0) return 0;
  const passing = probes.reduce(
    (sum, p) => (isPassing(p) ? sum + SEVERITY_WEIGHT[p.probe.severity] : sum),
    0,
  );
  return (passing / total) * 100;
}

/**
 * Score a flat list of probe results into a full audit report.
 *
 * Pure function: identical inputs always yield identical output.
 */
export function score(
  results: ProbeResult[],
  config: ScoreConfig,
): AuditReport {
  const { threshold } = config;

  const byCategory = new Map<Category, ProbeResult[]>();
  for (const result of results) {
    const list = byCategory.get(result.probe.category);
    if (list) {
      list.push(result);
    } else {
      byCategory.set(result.probe.category, [result]);
    }
  }

  const categories: CategoryResult[] = [];
  for (const [name, probes] of byCategory) {
    const catScore = categoryScore(probes);
    categories.push({
      name,
      score: catScore,
      passed: catScore >= threshold,
      probes,
    });
  }

  const overall =
    categories.length === 0
      ? 0
      : categories.reduce((sum, c) => sum + c.score, 0) / categories.length;

  return {
    passed: categories.length > 0 && overall >= threshold,
    score: overall,
    threshold,
    categories,
  };
}
