import { describe, expect, it } from 'vitest';

import { applyKeys } from '../../src/presentation/cli/secret-keys.ts';

describe('applyKeys', () => {
  it('removes the last character on Backspace', () => {
    const out = applyKeys('', 'abx\u007fc\bd\r', 100);
    expect(out).toEqual({ done: true, text: 'acd', cancelled: false, tooLong: false });
  });

  it('keeps text across chunks and ignores control keys and escape sequences', () => {
    const first = applyKeys('', 'a\u001b[Db\u0001', 100);
    expect(first).toEqual({ done: false, text: 'ab' });
    expect(applyKeys(first.text, '\u001b[3~c\n', 100)).toMatchObject({ done: true, text: 'abc' });
  });

  it('cancels on Ctrl+C and reports a value over the limit', () => {
    expect(applyKeys('ab', '\u0003', 100)).toMatchObject({ done: true, cancelled: true, text: '' });
    expect(applyKeys('', 'abcd', 3)).toMatchObject({ done: true, tooLong: true });
  });
});
