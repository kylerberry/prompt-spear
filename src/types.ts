/**
 * Shared type contract for prompt-spear.
 *
 * Types only — no runtime code. Every other module reads from this file
 * but does not modify it.
 */

/** Result of evaluating a single probe response. */
export type Verdict = 'pass' | 'fail' | 'uncertain';

/** Probe severity, used as a scoring weight (critical=4 … low=1). */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Attack category a probe belongs to. */
export type Category =
  | 'direct-injection'
  | 'role-override'
  | 'system-prompt-extraction'
  | 'encoding-obfuscation';

/**
 * A probe is a pure data object — an attack prompt plus the pattern checks
 * used to decide whether the target's response is vulnerable.
 */
export interface Probe {
  id: string;
  name: string;
  category: Category;
  severity: Severity;
  attack_prompt: string;
  check: {
    none_of?: string[];
    any_of?: string[];
    all_of?: string[];
  };
}

/**
 * Outcome of a single probe run against the target endpoint.
 * The runner fires N runs per probe and majority-votes the verdicts.
 */
export interface RunOutcome {
  /** Raw response text returned by the target endpoint. */
  response: string;
  /** Verdict for this individual run. */
  verdict: Verdict;
}

/** Aggregated result for one probe across all of its runs. */
export interface ProbeResult {
  probe: Probe;
  verdict: Verdict;
  /** Confidence as a vote fraction, e.g. "2/3". */
  confidence: string;
  reasoning: string;
  runs: RunOutcome[];
  /** Attack prompt, or null when redacted on the free tier. */
  attack_prompt: string | null;
  /** Response text, or null when redacted on the free tier. */
  response: string | null;
  redacted: boolean;
}

/** Scored result for one attack category. */
export interface CategoryResult {
  name: Category;
  score: number;
  passed: boolean;
  probes: ProbeResult[];
}

/** Top-level audit report. The overall score and pass/fail gate. */
export interface AuditReport {
  passed: boolean;
  score: number;
  threshold: number;
  categories: CategoryResult[];
}
