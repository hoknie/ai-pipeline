import { describe, expect, it } from 'vitest';

import { cost } from '../src/format.ts';

describe('cost', () => {
  it('formats a positive cost', () => {
    expect(cost({ costUsd: 1.234 })).toBe('$1.23');
  });

  it('is empty for a zero, null or missing cost', () => {
    expect(cost({ costUsd: 0 })).toBe('');
    expect(cost({ costUsd: null })).toBe('');
    expect(cost(null)).toBe('');
  });
});
