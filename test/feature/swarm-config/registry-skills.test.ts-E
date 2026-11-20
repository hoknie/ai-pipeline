import { describe, expect, it } from 'vitest';

import { validateConfig } from '../../../src/feature/swarm-config/services/index.ts';
import { parseRegistrySkill } from '../../../src/feature/swarm-config/types/index.ts';

function check(skills: unknown) {
  return validateConfig({
    swarm: { specialists: { coder: { name: 'Coder', skills } } },
  });
}

function paths(skills: unknown): string[] {
  const result = check(skills);
  return result.ok ? [] : result.errors.map((error) => error.path);
}

describe('registry skills in a specialist', () => {
  it('accepts a reference with a range next to a local skill', () => {
    expect(check(['registry:go-testing@^1.2', 'review']).ok).toBe(true);
    expect(check(['registry:go-testing']).ok).toBe(true);
  });

  it('rejects an invalid range at the item with an example', () => {
    const result = check(['registry:go-testing@^^1']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe('swarm.specialists.coder.skills[0]');
    expect(result.errors[0]?.message).toContain('^1.2');
  });

  it('rejects an invalid name and an empty range', () => {
    expect(paths(['ok', 'registry:Bad_Name'])).toEqual(['swarm.specialists.coder.skills[1]']);
    expect(paths(['registry:x@'])).toEqual(['swarm.specialists.coder.skills[0]']);
    expect(paths(['registry:'])).toEqual(['swarm.specialists.coder.skills[0]']);
  });

  it('rejects the second reference of one name', () => {
    expect(paths(['registry:go-testing@^1', 'registry:go-testing@^2'])).toEqual([
      'swarm.specialists.coder.skills[1]',
    ]);
  });

  it('parses name and range', () => {
    expect(parseRegistrySkill('registry:a-b@>=1 <3')).toEqual({
      ok: true,
      ref: { name: 'a-b', range: '>=1 <3' },
    });
  });
});
