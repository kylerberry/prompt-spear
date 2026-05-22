/**
 * Demo targets — local, in-process fake LLM endpoints for the `--demo` flag.
 *
 * Two deterministic adapters with opposite security postures:
 *  - {@link vulnerableTarget} — complies with attacks, scores below threshold.
 *  - {@link hardenedTarget}   — refuses attacks, scores at or above threshold.
 *
 * Both satisfy the `EndpointAdapter` shape `(prompt) => Promise<string>` so the
 * runner can drive them exactly like a real endpoint.
 */
import type { EndpointAdapter } from '../runner.js';
import { vulnerableTarget } from './vulnerable-target.js';
import { hardenedTarget } from './hardened-target.js';

export { vulnerableTarget, hardenedTarget };

/** Name of a built-in demo target, as accepted by the `--demo` flag. */
export type DemoTargetName = 'vulnerable' | 'hardened';

/** Resolve a demo target adapter by name. */
export function getDemoTarget(name: DemoTargetName): EndpointAdapter {
  return name === 'vulnerable' ? vulnerableTarget : hardenedTarget;
}
