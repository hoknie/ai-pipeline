import { describe, expect, it } from 'vitest';

import type { Violation } from './check.ts';
import { reconcile, type ExceptionEntry } from './reconcile.ts';

const long = (size: number): Violation => ({
  rule: 'file-size',
  path: 'src/a.ts',
  size,
  message: `src/a.ts: ${size} lines of code, limit 300`,
});
const entry = (size: number): ExceptionEntry => ({ rule: 'file-size', path: 'src/a.ts', size });

describe('reconcile', () => {
  it('passes when the violation is recorded and has not grown', () => {
    expect(reconcile([long(400)], [entry(400)])).toEqual([]);
    expect(reconcile([long(350)], [entry(400)])).toEqual([]);
  });

  it('fails when there is no entry', () => {
    const problems = reconcile([long(400)], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('src/a.ts');
    expect(problems[0]).toContain('not in the exception list');
  });

  it('fails when the size grew', () => {
    const problems = reconcile([long(401)], [entry(400)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('grew');
  });

  it('fails when the entry is no longer needed', () => {
    const problems = reconcile([], [entry(400)]);
    expect(problems).toEqual([
      'src/a.ts: exception file-size is no longer needed, remove it from the list',
    ]);
  });

  it('tells apart entries by function name', () => {
    const a: Violation = {
      rule: 'function-size',
      path: 'p.ts',
      name: 'a',
      size: 90,
      message: 'p.ts: a',
    };
    const b: Violation = { ...a, name: 'b', message: 'p.ts: b' };
    const only: ExceptionEntry = { rule: 'function-size', path: 'p.ts', name: 'a', size: 90 };
    expect(reconcile([a, b], [only])).toHaveLength(1);
  });

  it('never excuses rules without a limit', () => {
    const imports: Violation = {
      rule: 'imports',
      path: 'x.ts',
      size: 0,
      message: 'x.ts: bad import',
    };
    expect(reconcile([imports], [{ rule: 'imports', path: 'x.ts', size: 0 }])).toContain(
      'x.ts: bad import',
    );
  });

  it('reports a duplicate entry', () => {
    expect(reconcile([long(400)], [entry(400), entry(400)])).toHaveLength(1);
  });
});
