/**
 * Runner — orchestrates probe execution against the target endpoint.
 *
 * For each probe it fires N runs (default 3) in parallel, evaluates each
 * response with the pattern evaluator, and reduces the per-run verdicts to a
 * single probe verdict via majority vote. Probes themselves also run in
 * parallel. The runner does no scoring and no formatting — it returns raw
 * {@link ProbeResult}s for the scorer and reporter downstream.
 *
 * Design notes:
 *  - **Majority vote / tie-break:** the verdict with the strictly highest run
 *    count wins. Any tie (no single winner) resolves to `uncertain` — the
 *    conservative choice, since a split result is not a confident signal.
 *    `confidence` reports the winning count as a fraction, e.g. `"2/3"`.
 *  - **Per-run errors:** a failed endpoint call (any thrown error, e.g.
 *    {@link EndpointError}) becomes an `uncertain` run with an empty response
 *    rather than crashing the whole audit.
 *  - **Redaction:** partial-reveal redaction is the reporter's job (see
 *    CLAUDE.md / PRD §Reporter). The runner therefore populates
 *    `attack_prompt` and `response` unredacted and sets `redacted: false`.
 */
import type {
  Category,
  Probe,
  ProbeResult,
  RunOutcome,
  Verdict,
} from './types.js';
import { evaluate } from './evaluators/pattern.js';

/** Endpoint adapter shape — matches `callEndpoint` bound to a config. */
export type EndpointAdapter = (prompt: string) => Promise<string>;

/** Runtime configuration for a runner invocation. */
export interface RunnerConfig {
  /** Number of runs fired per probe. Default: 3. */
  runsPerProbe?: number;
  /** Optional category allow-list. When set, only matching probes run. */
  categories?: Category[];
}

const DEFAULT_RUNS_PER_PROBE = 3;

/**
 * Run a single probe `runsPerProbe` times in parallel and aggregate the
 * per-run verdicts into a {@link ProbeResult}.
 */
async function runProbe(
  probe: Probe,
  adapter: EndpointAdapter,
  runsPerProbe: number,
): Promise<ProbeResult> {
  const runs: RunOutcome[] = await Promise.all(
    Array.from({ length: runsPerProbe }, async (): Promise<RunOutcome> => {
      try {
        const response = await adapter(probe.attack_prompt);
        return { response, verdict: evaluate(probe.check, response) };
      } catch {
        // A failed endpoint call is an inconclusive run, never a crash.
        return { response: '', verdict: 'uncertain' };
      }
    }),
  );

  const { verdict, count } = majorityVote(runs);
  const confidence = `${count}/${runsPerProbe}`;
  const lastResponse = runs.length > 0 ? runs[runs.length - 1]!.response : '';

  return {
    probe,
    verdict,
    confidence,
    reasoning: `Majority vote across ${runsPerProbe} run(s): ${verdict} (${confidence}).`,
    runs,
    attack_prompt: probe.attack_prompt,
    response: lastResponse,
    redacted: false,
  };
}

/**
 * Reduce per-run verdicts to a final verdict. The verdict with the strictly
 * highest count wins; any tie resolves to `uncertain`.
 */
function majorityVote(runs: RunOutcome[]): { verdict: Verdict; count: number } {
  const tally: Record<Verdict, number> = { pass: 0, fail: 0, uncertain: 0 };
  for (const run of runs) tally[run.verdict] += 1;

  const entries = Object.entries(tally) as [Verdict, number][];
  const top = Math.max(...entries.map(([, n]) => n));
  const winners = entries.filter(([, n]) => n === top);

  if (winners.length === 1) {
    return { verdict: winners[0]![0], count: top };
  }
  // No single winner — a split vote is not a confident signal.
  return { verdict: 'uncertain', count: top };
}

/**
 * Execute `probes` against `adapter`, optionally filtered by category.
 *
 * @param probes  The full probe set to consider.
 * @param adapter Endpoint adapter — receives an attack prompt, returns the
 *                target's response text. Errors are tolerated per-run.
 * @param config  `{ runsPerProbe?, categories? }`.
 * @returns One {@link ProbeResult} per probe that survived the category filter.
 */
export async function runProbes(
  probes: Probe[],
  adapter: EndpointAdapter,
  config: RunnerConfig = {},
): Promise<ProbeResult[]> {
  const runsPerProbe = config.runsPerProbe ?? DEFAULT_RUNS_PER_PROBE;

  const selected = config.categories
    ? probes.filter((probe) => config.categories!.includes(probe.category))
    : probes;

  return Promise.all(
    selected.map((probe) => runProbe(probe, adapter, runsPerProbe)),
  );
}
