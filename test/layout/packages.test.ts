import { describe, expect, it } from 'vitest';

import { packageViolations } from './check.ts';
import { makeTree } from './tree.ts';

const using = (specifier: string, kind = 'import') =>
  kind === 'type'
    ? `import type { X } from '${specifier}';\nexport type Y = X;\n`
    : `import { x } from '${specifier}';\nexport const y = x;\n`;

function paths(files: Record<string, string>): string[] {
  return packageViolations(makeTree(files)).map((item) => item.path);
}

describe('packageViolations', () => {
  it('rejects zod in types and services, allows it in clients and presentation', () => {
    expect(
      paths({
        'feature/tags/types/a.ts': using('zod'),
        'feature/tags/services/b.ts': using('zod'),
        'feature/tags/clients/x/c.ts': using('zod'),
        'presentation/ipc/contract/d.ts': using('zod'),
      }).sort(),
    ).toEqual(['feature/tags/services/b.ts', 'feature/tags/types/a.ts']);
  });

  it('allows yaml in presentation/cli and rejects it in presentation/mcp', () => {
    expect(
      paths({
        'presentation/cli/a.ts': using('yaml'),
        'presentation/mcp/b.ts': using('yaml'),
        'feature/swarm-config/services/c.ts': using('yaml'),
      }),
    ).toEqual(['presentation/mcp/b.ts']);
  });

  it('rejects commander outside presentation/cli', () => {
    expect(
      paths({
        'presentation/cli/a.ts': using('commander'),
        'presentation/web/b.ts': using('commander'),
      }),
    ).toEqual(['presentation/web/b.ts']);
  });

  it('checks subpaths of the MCP SDK and unknown packages', () => {
    expect(
      paths({
        'presentation/mcp/a.ts': using('@modelcontextprotocol/sdk/server/mcp.js'),
        'feature/tags/services/b.ts': using('@modelcontextprotocol/sdk/types.js'),
        'platform/git/c.ts': using('left-pad'),
      }).sort(),
    ).toEqual(['feature/tags/services/b.ts', 'platform/git/c.ts']);
  });

  it('counts an import of a type like a value import', () => {
    expect(paths({ 'feature/tags/types/a.ts': using('zod', 'type') })).toEqual([
      'feature/tags/types/a.ts',
    ]);
  });

  it('ignores node: modules and relative imports', () => {
    expect(
      paths({
        'feature/tags/types/a.ts': using('node:fs'),
        'feature/tags/types/b.ts': using('./a.ts'),
      }),
    ).toEqual([]);
  });

  it('keeps old folders in the table', () => {
    expect(paths({ 'protocol/a.ts': using('zod'), 'store/b.ts': using('zod') })).toEqual([
      'store/b.ts',
    ]);
  });
});
