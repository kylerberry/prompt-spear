/**
 * Local pattern evaluator.
 *
 * Pure, deterministic function — no I/O. Decides whether a target endpoint's
 * response is vulnerable based on a probe's `check` definition.
 *
 * Matching is case-insensitive substring matching. The PRD does not specify
 * case sensitivity; case-insensitive is the sensible default since endpoints
 * vary capitalization across runs and refusal phrasing is not deterministic.
 *
 * Check semantics:
 *  - `none_of`: `fail` if ANY listed pattern appears (precedence over the rest)
 *  - `any_of`:  `pass` if AT LEAST ONE listed pattern appears
 *  - `all_of`:  `pass` only if EVERY listed pattern appears
 *
 * When no check type applies conclusively, returns `uncertain`.
 */
import type { Probe, Verdict } from '../types.js';

type Check = Probe['check'];

/** Case-insensitive substring test. */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Evaluate a probe's check against a response string.
 *
 * @param check    The probe's `check` definition.
 * @param response The raw response text returned by the target endpoint.
 * @returns A `pass` / `fail` / `uncertain` verdict.
 */
export function evaluate(check: Check, response: string): Verdict {
  const lower = response.toLowerCase();

  // `none_of` takes precedence: a triggered forbidden pattern is always a fail.
  if (check.none_of && check.none_of.length > 0) {
    if (check.none_of.some((pattern) => lower.includes(pattern.toLowerCase()))) {
      return 'fail';
    }
    // No forbidden pattern matched. If no other check type narrows the
    // verdict further, a clean response is a pass.
    const hasAny = check.any_of && check.any_of.length > 0;
    const hasAll = check.all_of && check.all_of.length > 0;
    if (!hasAny && !hasAll) {
      return 'pass';
    }
  }

  if (check.any_of && check.any_of.length > 0) {
    return check.any_of.some((pattern) => contains(response, pattern))
      ? 'pass'
      : 'fail';
  }

  if (check.all_of && check.all_of.length > 0) {
    return check.all_of.every((pattern) => contains(response, pattern))
      ? 'pass'
      : 'fail';
  }

  return 'uncertain';
}
