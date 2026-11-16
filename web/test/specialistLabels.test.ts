import { describe, expect, it } from 'vitest';

import { specialistOptions } from '../src/shared/lib/specialistLabels.ts';

import { specialistEntry } from './fixtures.ts';

describe('specialist choices of a settings form', () => {
  it('labels a specialist with its name and keeps the slug as the value', () => {
    const options = specialistOptions([
      specialistEntry('resolver', {}, { name: 'Conflict resolver' }),
    ]);
    expect(options).toEqual([{ slug: 'resolver', label: 'Conflict resolver' }]);
  });

  it('takes the name of the file when the effective one is missing', () => {
    const options = specialistOptions([
      specialistEntry('legacy', { effective: null, raw: { name: 'Legacy one' } }),
    ]);
    expect(options).toEqual([{ slug: 'legacy', label: 'Legacy one' }]);
  });

  it('labels a specialist without a name with its slug', () => {
    const options = specialistOptions([
      specialistEntry('legacy', { effective: null, raw: { model: 'sonnet' } }),
    ]);
    expect(options).toEqual([{ slug: 'legacy', label: 'legacy' }]);
  });

  it('adds the slug to the names that are the same', () => {
    const options = specialistOptions([
      specialistEntry('a', {}, { name: 'Review' }),
      specialistEntry('b', {}, { name: 'Review' }),
      specialistEntry('c', {}, { name: 'Coder' }),
    ]);
    expect(options).toEqual([
      { slug: 'a', label: 'Review (a)' },
      { slug: 'b', label: 'Review (b)' },
      { slug: 'c', label: 'Coder' },
    ]);
  });

  it('keeps the slug of a specialist without a name when another one has the same name', () => {
    const options = specialistOptions([
      specialistEntry('legacy', { effective: null, raw: {} }),
      specialistEntry('x', {}, { name: 'legacy' }),
    ]);
    expect(options).toEqual([
      { slug: 'legacy', label: 'legacy' },
      { slug: 'x', label: 'legacy (x)' },
    ]);
  });
});
