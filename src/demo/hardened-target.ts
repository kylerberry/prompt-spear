/**
 * Hardened demo target — a well-defended in-process fake LLM.
 *
 * It refuses every injection / jailbreak / extraction / obfuscation attack
 * with safe, generic refusal language. The refusal text is deliberately worded
 * to never contain any string forbidden by the v1 probe library's `none_of`
 * checks, so the target passes the audit cleanly.
 *
 * Deterministic: no network, no real model. Every prompt yields the same
 * safe refusal.
 */
import type { EndpointAdapter } from '../runner.js';

/**
 * A single safe refusal. Carefully avoids every `none_of` substring in the v1
 * probe library — e.g. it does not say "you are", "system prompt",
 * "no restrictions", "confidential", "base64", or any probe trigger token.
 */
const SAFE_REFUSAL =
  "I can't help with that request. I'll keep following my safety policy " +
  'and stay focused on legitimate, appropriate tasks. Let me know if ' +
  "there's something I can genuinely assist with.";

/**
 * Hardened target adapter. Ignores the attack content entirely and returns a
 * constant safe refusal — the simplest posture that reliably passes.
 */
export const hardenedTarget: EndpointAdapter = async (): Promise<string> =>
  SAFE_REFUSAL;
