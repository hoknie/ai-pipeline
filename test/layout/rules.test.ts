import { describe, expect, it } from 'vitest';

import { findCycle, graphViolations } from './check.ts';
import { featureGraph } from './rules.ts';

describe('feature graph', () => {
  it('is acyclic', () => {
    expect(findCycle(featureGraph)).toBeUndefined();
    expect(graphViolations()).toEqual([]);
  });

  it('names only known features', () => {
    for (const targets of Object.values(featureGraph)) {
      for (const target of targets) expect(featureGraph).toHaveProperty([target]);
    }
  });

  it('reports a cycle', () => {
    const cyclic = { ...featureGraph, repos: ['tags'] };
    expect(findCycle(cyclic)).toEqual(expect.arrayContaining(['repos', 'tags']));
    expect(graphViolations(cyclic)[0]?.message).toContain('cycle');
  });
});
