import { describe, expect, it } from 'vitest';

import { isUnused, levelEntries, providerUsage } from '../src/features/swarm/index.ts';
import type { ConfigEditorResponse } from '../src/shared/api/types.ts';

type Entries = Pick<ConfigEditorResponse, 'chains' | 'specialists' | 'pipelines'>;

const source = (raw: Record<string, unknown>) => ({ file: '/f', revision: 'r', raw });

function entries(): Entries {
  const thinking = {
    name: 'Thinking',
    runtimes: [
      { provider: 'anthropic', runtime: 'claude', model: 'opus' },
      { provider: 'zai', runtime: 'claude', model: 'glm' },
    ],
  };
  const coder = { name: 'Coder', runtime_chain: 'thinking' };
  const feature = {
    name: 'Feature',
    steps: [
      { id: 'plan', specialist: 'planner' },
      { id: 'code', specialist: 'coder' },
    ],
    split: { specialist: 'coder' },
  };
  return {
    chains: [
      {
        slug: 'thinking',
        level: 'project',
        file: '/f',
        revision: 'r',
        raw: thinking,
        sources: { project: source(thinking) },
      },
    ],
    specialists: [
      {
        slug: 'coder',
        level: 'project',
        file: '/f',
        revision: 'r',
        raw: coder,
        sources: { project: source(coder) },
      },
      {
        slug: 'planner',
        level: 'global',
        file: '/f',
        revision: null,
        raw: { name: 'Planner' },
        sources: { global: source({ name: 'Planner' }) },
      },
    ],
    pipelines: [
      {
        id: 'feature',
        level: 'project',
        file: '/f',
        revision: 'r',
        raw: feature,
        sources: { project: source(feature) },
      },
    ],
  } as unknown as Entries;
}

describe('providerUsage', () => {
  it('finds the chain with the numbers of its items, the specialist and the pipeline', () => {
    const usage = providerUsage(entries(), 'zai');
    expect(usage.chains).toEqual([{ slug: 'thinking', name: 'Thinking', items: [2] }]);
    expect(usage.specialists).toEqual([{ slug: 'coder', name: 'Coder' }]);
    expect(usage.pipelines).toEqual([
      { id: 'feature', name: 'Feature', steps: ['code'], split: true },
    ]);
    expect(isUnused(usage)).toBe(false);
  });

  it('is empty for a provider no chain names', () => {
    const usage = providerUsage(entries(), 'openai');
    expect(usage).toEqual({ chains: [], specialists: [], pipelines: [] });
    expect(isUnused(usage)).toBe(true);
  });

  it('counts the shared files only for the shared scope', () => {
    const all = entries();
    expect(levelEntries(all, 'project')).toBe(all);
    const shared = levelEntries(all, 'global');
    expect(shared.chains).toEqual([]);
    expect(shared.specialists.map((item) => item.slug)).toEqual(['planner']);
    expect(isUnused(providerUsage(shared, 'zai'))).toBe(true);
  });
});
