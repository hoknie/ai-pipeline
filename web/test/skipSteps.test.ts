import { describe, expect, it } from 'vitest';

import { skipLocked } from '../src/shared/ui/forms/picker/SkipSteps.tsx';

describe('skipLocked', () => {
  it('locks everything when the field is disabled', () => {
    expect(skipLocked('a', [], [], 3, true)).toBe(true);
  });

  it('locks a step of the variant', () => {
    expect(skipLocked('a', ['a'], ['a'], 3, false)).toBe(true);
  });

  it('locks the last unmarked step only', () => {
    expect(skipLocked('c', ['a', 'b'], [], 3, false)).toBe(true);
    expect(skipLocked('a', ['a', 'b'], [], 3, false)).toBe(false);
    expect(skipLocked('c', ['a'], [], 3, false)).toBe(false);
  });
});
