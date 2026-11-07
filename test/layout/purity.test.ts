import { describe, expect, it } from 'vitest';

import { purityViolations } from './check.ts';
import { reconcile, type ExceptionEntry } from './reconcile.ts';
import { makeTree } from './tree.ts';

describe('purityViolations', () => {
  it('passes a file with no external dependency', () => {
    const root = makeTree({
      'feature/tags/types/a.ts': `import { b } from './b.ts';\nexport const a = b;\n`,
      'feature/tags/types/b.ts': 'export const b = 1;\n',
    });
    expect(purityViolations(root)).toEqual([]);
  });

  it('reports node:fs behind a re-export and shows the chain', () => {
    const root = makeTree({
      'feature/runs/machine/a.ts': `import { helper } from '../../../platform/git/index.ts';\nexport const a = helper;\n`,
      'platform/git/index.ts': `export * from './runner.ts';\n`,
      'platform/git/runner.ts': `import { readFileSync } from 'node:fs';\nexport const helper = readFileSync;\n`,
    });
    const found = purityViolations(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('feature/runs/machine/a.ts');
    expect(found[0]?.message).toContain(
      'feature/runs/machine/a.ts → platform/git/index.ts → platform/git/runner.ts → node:fs',
    );
  });

  it('reports a direct node:* import even when a recorded chain already reaches it', () => {
    const root = makeTree({
      'feature/tags/types/a.ts': `import { readFileSync } from 'node:fs';\nimport { b } from './b.ts';\nexport const a = [readFileSync, b];\n`,
      'feature/tags/types/b.ts': `import { writeFileSync } from 'node:fs';\nexport const b = writeFileSync;\n`,
    });
    const found = purityViolations(root);
    const direct = found.filter((item) => item.rule === 'direct-import');
    expect(direct.map((item) => item.path)).toEqual([
      'feature/tags/types/a.ts',
      'feature/tags/types/b.ts',
    ]);
    const recorded: ExceptionEntry[] = [
      { rule: 'purity', path: 'feature/tags/types/a.ts', name: 'node:fs', size: 1 },
      { rule: 'purity', path: 'feature/tags/types/b.ts', name: 'node:fs', size: 1 },
    ];
    const problems = reconcile(found, recorded);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('imports `node:fs` directly');
  });

  it('ignores an import of a type only', () => {
    const root = makeTree({
      'feature/tags/types/a.ts': `import type { Helper } from '../../../platform/git/runner.ts';\nexport type A = Helper;\n`,
      'platform/git/runner.ts': `import { readFileSync } from 'node:fs';\nexport type Helper = typeof readFileSync;\n`,
    });
    expect(purityViolations(root)).toEqual([]);
  });

  it('reports an external package in pure views and platform/errors', () => {
    const root = makeTree({
      'feature/tags/types/a.ts': `import { z } from 'zod';\nexport const a = z;\n`,
      'platform/errors/b.ts': `import { z } from 'zod';\nexport const b = z;\n`,
      'platform/git/c.ts': `import { z } from 'zod';\nexport const c = z;\n`,
    });
    expect(
      purityViolations(root)
        .filter((item) => item.rule === 'purity')
        .map((item) => item.path)
        .sort(),
    ).toEqual(['feature/tags/types/a.ts', 'platform/errors/b.ts']);
  });

  it('reports a swapped dependency behind a recorded chain', () => {
    const entries: ExceptionEntry[] = [
      { rule: 'purity', path: 'feature/tags/types/a.ts', name: 'node:os', size: 1 },
    ];
    const before = makeTree({
      'feature/tags/types/a.ts': `import { b } from './b.ts';\nexport const a = b;\n`,
      'feature/tags/types/b.ts': `import { x } from './c.ts';\nexport const b = x;\n`,
      'feature/tags/types/c.ts': `export { arch } from 'node:os';\n`,
    });
    const onlyA = (root: string) =>
      purityViolations(root).filter(
        (item) => item.rule === 'purity' && item.path === 'feature/tags/types/a.ts',
      );
    expect(reconcile(onlyA(before), entries)).toEqual([]);
    const after = makeTree({
      'feature/tags/types/a.ts': `import { b } from './b.ts';\nexport const a = b;\n`,
      'feature/tags/types/b.ts': `import { x } from './c.ts';\nexport const b = x;\n`,
      'feature/tags/types/c.ts': `export { cwd } from 'node:child_process';\n`,
    });
    const problems = reconcile(onlyA(after), entries);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('node:child_process');
    expect(problems.join('\n')).toContain('no longer needed');
  });
});
