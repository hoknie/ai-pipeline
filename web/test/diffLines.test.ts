import { describe, expect, it } from 'vitest';

import { parseHunks } from '../src/components/runs/diffLines.ts';

describe('parseHunks', () => {
  it('numbers the old and the new lines of each hunk', () => {
    const hunks = parseHunks([
      '@@ -10,3 +10,3 @@ function f() {',
      ' keep',
      '-old',
      '+new',
      '+more',
      '@@ -40 +41 @@',
      '-gone',
    ]);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.header).toBe('@@ -10,3 +10,3 @@ function f() {');
    expect(hunks[0]!.rows).toEqual([
      { kind: 'ctx', old: 10, new: 10, text: 'keep' },
      { kind: 'del', old: 11, new: null, text: 'old' },
      { kind: 'add', old: null, new: 11, text: 'new' },
      { kind: 'add', old: null, new: 12, text: 'more' },
    ]);
    expect(hunks[1]!.rows).toEqual([{ kind: 'del', old: 40, new: null, text: 'gone' }]);
  });

  it('keeps the no-newline marker as a note without numbers', () => {
    const [hunk] = parseHunks(['@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b']);
    expect(hunk!.rows[1]).toEqual({
      kind: 'note',
      old: null,
      new: null,
      text: '\\ No newline at end of file',
    });
    expect(hunk!.rows[2]).toMatchObject({ kind: 'add', new: 1 });
  });

  it('is empty without hunks', () => {
    expect(parseHunks([])).toEqual([]);
    expect(parseHunks(['stray'])).toEqual([]);
  });
});
