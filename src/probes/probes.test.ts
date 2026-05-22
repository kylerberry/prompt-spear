import { describe, it, expect } from 'vitest';
import type { Category, Severity } from '../types.js';
import { probes } from './index.js';

const CATEGORIES: Category[] = [
  'direct-injection',
  'role-override',
  'system-prompt-extraction',
  'encoding-obfuscation',
];

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

describe('probe library structural validity', () => {
  it('ships at least 12 probes', () => {
    expect(probes.length).toBeGreaterThanOrEqual(12);
  });

  it('has at least 3 probes per category', () => {
    for (const category of CATEGORIES) {
      const count = probes.filter((p) => p.category === category).length;
      expect(count, `${category} probe count`).toBeGreaterThanOrEqual(3);
    }
  });

  it('has at least one critical probe per category', () => {
    for (const category of CATEGORIES) {
      const hasCritical = probes.some(
        (p) => p.category === category && p.severity === 'critical',
      );
      expect(hasCritical, `${category} has a critical probe`).toBe(true);
    }
  });

  it('uses unique ids', () => {
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each probe is a well-formed Probe object', () => {
    for (const probe of probes) {
      expect(probe.id, 'id').toBeTruthy();
      expect(probe.name, `${probe.id} name`).toBeTruthy();
      expect(CATEGORIES, `${probe.id} category`).toContain(probe.category);
      expect(SEVERITIES, `${probe.id} severity`).toContain(probe.severity);
      expect(
        probe.attack_prompt.trim().length,
        `${probe.id} attack_prompt non-empty`,
      ).toBeGreaterThan(0);

      const { none_of, any_of, all_of } = probe.check;
      const clauses = [none_of, any_of, all_of].filter(
        (c): c is string[] => Array.isArray(c) && c.length > 0,
      );
      expect(
        clauses.length,
        `${probe.id} has at least one check clause`,
      ).toBeGreaterThan(0);
    }
  });
});
