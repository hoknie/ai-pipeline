import { describe, expect, it } from 'vitest';

import { environmentViolations } from './check.ts';
import { makeTree } from './tree.ts';

const read = 'export const home = process.env.HOME;\n';

describe('environmentViolations', () => {
  it('allows the entry point, app and platform', () => {
    const root = makeTree({
      'cli/main.ts': read,
      'app/a.ts': read,
      'platform/paths/b.ts': read,
    });
    expect(environmentViolations(root)).toEqual([]);
  });

  it('reports other places and counts the reads', () => {
    const root = makeTree({
      'feature/tags/services/a.ts': 'export const all = [process.env.A, process.env.B];\n',
      'cli/other.ts': read,
      'presentation/cli/c.ts': 'export const env = { ...process.env };\n',
    });
    const found = environmentViolations(root);
    expect(found.map((item) => [item.path, item.size]).sort()).toEqual([
      ['cli/other.ts', 1],
      ['feature/tags/services/a.ts', 2],
      ['presentation/cli/c.ts', 1],
    ]);
  });

  it('ignores the word in a string or a comment', () => {
    const root = makeTree({
      'feature/tags/services/a.ts': "// process.env\nexport const text = 'process.env';\n",
    });
    expect(environmentViolations(root)).toEqual([]);
  });
});
