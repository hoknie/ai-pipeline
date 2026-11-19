import { describe, expect, it } from 'vitest';

import { nameStatusFiles } from '../../../src/platform/git/index.ts';

describe('the files of `git diff --name-status -M -z`', () => {
  it('lists one path of a change and both paths of a rename or a copy, sorted without repeats', () => {
    const output = [
      'M',
      'b.ts',
      'A',
      'a.ts',
      'R100',
      'old.ts',
      'new.ts',
      'C75',
      'src.ts',
      'copy.ts',
      'D',
      'b.ts',
      '',
    ].join('\0');
    expect(nameStatusFiles(output)).toEqual([
      'a.ts',
      'b.ts',
      'copy.ts',
      'new.ts',
      'old.ts',
      'src.ts',
    ]);
  });

  it('is empty for an empty output', () => {
    expect(nameStatusFiles('')).toEqual([]);
  });
});
