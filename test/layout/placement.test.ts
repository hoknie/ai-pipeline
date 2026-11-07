import { describe, expect, it } from 'vitest';

import { placementViolations } from './check.ts';
import { makeTree } from './tree.ts';

const code = 'export const value = 1;\n';
const indexOnlyReexports = `export { a } from './a.ts';\nexport type { B } from './b.ts';\n`;

function paths(files: Record<string, string>): string[] {
  return placementViolations(makeTree(files))
    .map((item) => item.path)
    .sort();
}

describe('placementViolations', () => {
  it('rejects a .ts in the feature root and an unknown view', () => {
    expect(
      paths({
        'feature/tags/helper.ts': code,
        'feature/tags/utils/a.ts': code,
        'feature/tags/types/a.ts': code,
      }),
    ).toEqual(['feature/tags/helper.ts', 'feature/tags/utils/a.ts']);
  });

  it('rejects machine outside runs and repositories in compose', () => {
    expect(
      paths({
        'feature/runs/machine/a.ts': code,
        'feature/queue/machine/a.ts': code,
        'feature/compose/repositories/a.ts': code,
        'feature/compose/services/a.ts': code,
      }),
    ).toEqual(['feature/compose/repositories/a.ts', 'feature/queue/machine/a.ts']);
  });

  it('rejects code in index.ts of presentation and platform', () => {
    expect(
      paths({
        'presentation/cli/index.ts': code,
        'platform/git/index.ts': code,
        'platform/fs/index.ts': indexOnlyReexports,
      }),
    ).toEqual(['platform/git/index.ts', 'presentation/cli/index.ts']);
  });

  it('rejects code in index.ts of any view', () => {
    expect(
      paths({
        'feature/tags/types/index.ts': code,
        'feature/tags/services/index.ts': 'export const s = new FooService();\n',
        'feature/tags/ports/index.ts': indexOnlyReexports,
      }),
    ).toEqual([
      'feature/tags/services/index.ts',
      'feature/tags/services/index.ts',
      'feature/tags/types/index.ts',
    ]);
  });

  it('rejects new of an assembled class outside app and services/create.ts', () => {
    expect(
      paths({
        'presentation/cli/a.ts': 'export const s = new FooService();\n',
        'feature/tags/services/foo.ts': 'export const s = new FooService();\n',
        'feature/tags/services/create.ts': 'export const s = new FooService();\n',
        'app/application.ts':
          'export const s = [new FooService(), new TagRepository(), new ClaudeClient()];\n',
      }),
    ).toEqual(['feature/tags/services/foo.ts', 'presentation/cli/a.ts']);
  });

  it('does not touch other classes or old layers', () => {
    expect(
      paths({
        'feature/tags/services/foo.ts':
          'export const s = new Map();\nexport const e = new Error("x");\n',
        'daemon/a.ts': 'export const s = new FooService();\n',
      }),
    ).toEqual([]);
  });
});
