import type { Probe } from '../types.js';
import { directInjectionProbes } from './direct-injection.js';
import { roleOverrideProbes } from './role-override.js';
import { systemPromptExtractionProbes } from './system-prompt-extraction.js';
import { encodingObfuscationProbes } from './encoding-obfuscation.js';

export {
  directInjectionProbes,
  roleOverrideProbes,
  systemPromptExtractionProbes,
  encodingObfuscationProbes,
};

/** The full v1 probe library — every category aggregated into one battery. */
export const probes: Probe[] = [
  ...directInjectionProbes,
  ...roleOverrideProbes,
  ...systemPromptExtractionProbes,
  ...encodingObfuscationProbes,
];
