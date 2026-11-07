import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findCycle, graphViolations } from './check.ts';
import { featureGraph, featureViews, sizeLimits } from './rules.ts';

const document = readFileSync(join(import.meta.dirname, '..', '..', 'ARCHITECTURE.md'), 'utf8');

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

describe('rules match the layout document', () => {
  it('has the same feature graph', () => {
    const block = /Граф фич[^\n]*\n\n```\n([\s\S]*?)```/.exec(document)?.[1] ?? '';
    const parsed: Record<string, string[]> = {};
    for (const line of block.split('\n').filter((item) => item.trim() !== '')) {
      const [name = '', targets] = line.split('→');
      parsed[name.trim()] = targets ? targets.split(',').map((item) => item.trim()) : [];
    }
    expect(parsed).toEqual(featureGraph);
  });

  it('has the same views', () => {
    const block = /src\/feature\/<фича>\/\n([\s\S]*?)```/.exec(document)?.[1] ?? '';
    const views = [...block.matchAll(/^[├└]── ([a-z]+)\//gm)].map((match) => match[1]);
    expect(views.sort()).toEqual([...featureViews].sort());
  });

  it('has the same size limits', () => {
    expect(document).toContain(`не больше ${sizeLimits.file} строк кода`);
    expect(document).toContain(`не больше ${sizeLimits.function} строк кода`);
    expect(document).toContain(`не больше ${sizeLimits.folder} файлов`);
    expect(document).toContain(`не больше ${sizeLimits.classMethods} методов`);
  });
});
