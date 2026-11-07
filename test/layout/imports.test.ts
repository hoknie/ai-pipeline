import { describe, expect, it } from 'vitest';

import { importViolations } from './check.ts';
import { makeTree, stub } from './tree.ts';

/** Нарушения для одного файла `from`, который импортирует `to`. */
function check(from: string, to: string, extra: Record<string, string> = {}): string[] {
  const relative = to.split('/');
  const fromParts = from.split('/');
  fromParts.pop();
  let common = 0;
  while (common < fromParts.length && fromParts[common] === relative[common]) common += 1;
  const up = fromParts.length - common;
  const specifier = `${up === 0 ? './' : '../'.repeat(up)}${relative.slice(common).join('/')}`;
  const root = makeTree({
    [from]: `import { value } from '${specifier}';\nexport const x = value;\n`,
    [to]: stub,
    ...extra,
  });
  return importViolations(root).map((item) => item.message);
}

const bad = (messages: string[]) => expect(messages).not.toEqual([]);
const ok = (messages: string[]) => expect(messages).toEqual([]);

describe('importViolations: old layers', () => {
  it('allows listed layers and the same layer', () => {
    ok(check('runtime/a.ts', 'feature/agents/types/index.ts'));
    ok(check('runtime/a.ts', 'runtime/b.ts'));
  });

  it('rejects layers outside the table and unknown layers', () => {
    bad(check('runtime/a.ts', 'daemon/b.ts'));
    expect(check('weird/a.ts', 'daemon/b.ts')[0]).toContain('unknown layer');
  });

  it('counts type imports like value imports', () => {
    const root = makeTree({
      'runtime/a.ts': `import type { X } from '../daemon/b.ts';\n`,
      'daemon/b.ts': 'export type X = 1;\n',
    });
    expect(importViolations(root)).toHaveLength(1);
  });

  it('flags import() with a string like a static import', () => {
    const root = makeTree({
      'runtime/a.ts': `export const f = () => import('../daemon/b.ts');\n`,
      'daemon/b.ts': stub,
    });
    expect(importViolations(root)).toHaveLength(1);
  });

  it('rejects an import that leaves the tree', () => {
    const root = makeTree({
      'runtime/a.ts': `import data from '../../x.json';\nexport { data };\n`,
    });
    expect(importViolations(root)[0]?.message).toContain('leaves the source tree');
  });
});

describe('importViolations: features', () => {
  it('allows a feature to import its own views by the view table', () => {
    ok(check('feature/tags/services/a.ts', 'feature/tags/repositories/b.ts'));
    ok(check('feature/tags/services/a.ts', 'feature/tags/types/b.ts'));
    ok(check('feature/tags/services/a.ts', 'platform/git/b.ts'));
    bad(check('feature/tags/types/a.ts', 'feature/tags/services/b.ts'));
    bad(check('feature/tags/types/a.ts', 'platform/git/b.ts'));
    ok(check('feature/tags/types/a.ts', 'platform/errors/b.ts'));
    bad(check('feature/tags/services/a.ts', 'feature/tags/clients/x/b.ts'));
  });

  it('rejects the foreign repositories', () => {
    bad(check('feature/queue/services/a.ts', 'feature/repos/repositories/index.ts'));
  });

  it('allows an arrow of the graph through index.ts and rejects the rest', () => {
    ok(check('feature/tags/services/a.ts', 'feature/repos/services/index.ts'));
    bad(check('feature/tags/services/a.ts', 'feature/repos/services/inner.ts'));
    bad(check('feature/repos/services/a.ts', 'feature/tags/services/index.ts'));
    bad(check('feature/tags/services/a.ts', 'feature/repos/ports/index.ts'));
    bad(check('feature/tags/services/a.ts', 'feature/repos/clients/index.ts'));
  });

  it('keeps pure views to types of other features', () => {
    ok(check('feature/tags/types/a.ts', 'feature/repos/types/index.ts'));
    bad(check('feature/tags/types/a.ts', 'feature/repos/services/index.ts'));
    bad(check('feature/tags/machine/a.ts', 'feature/repos/services/index.ts'));
  });

  it('does not let features import presentation, app or old layers', () => {
    bad(check('feature/tags/services/a.ts', 'presentation/cli/a.ts'));
    bad(check('feature/tags/services/a.ts', 'app/a.ts'));
    bad(check('feature/tags/services/a.ts', 'daemon/a.ts'));
  });
});

describe('importViolations: platform and app', () => {
  it('keeps platform to itself', () => {
    ok(check('platform/git/a.ts', 'platform/errors/b.ts'));
    bad(check('platform/git/a.ts', 'feature/tags/types/index.ts'));
  });

  it('lets platform/errors in for types, machine and the open views', () => {
    ok(check('feature/tags/types/a.ts', 'platform/errors/b.ts'));
    ok(check('feature/tags/services/a.ts', 'platform/errors/b.ts'));
    ok(check('feature/runs/machine/a.ts', 'platform/errors/b.ts'));
    bad(check('feature/tags/ports/a.ts', 'platform/errors/b.ts'));
  });

  it('lets app run the ipc server and rejects the other presentation', () => {
    ok(check('app/a.ts', 'presentation/ipc/server.ts'));
    bad(check('app/a.ts', 'presentation/web/index.ts'));
  });

  it('lets app assemble the old layers it builds from, but not cli or mcp', () => {
    ok(check('app/a.ts', 'daemon/b.ts'));
    ok(check('app/a.ts', 'runtime/b.ts'));
    bad(check('app/a.ts', 'cli/b.ts'));
    bad(check('app/a.ts', 'protocol/b.ts'));
  });

  it('lets app see services, clients and (for now) repositories, only through index.ts', () => {
    ok(check('app/a.ts', 'feature/tags/services/index.ts'));
    ok(check('app/a.ts', 'feature/agents/clients/index.ts'));
    ok(check('app/a.ts', 'feature/agents/clients/claude/index.ts'));
    ok(check('app/a.ts', 'feature/tags/repositories/index.ts'));
    bad(check('app/a.ts', 'feature/tags/repositories/tags.ts'));
    bad(check('app/a.ts', 'feature/tags/services/inner.ts'));
    bad(check('app/a.ts', 'presentation/cli/a.ts'));
  });
});

describe('importViolations: presentation', () => {
  it('lets ipc/client read ipc/contract and not the reverse', () => {
    ok(check('presentation/ipc/client/a.ts', 'presentation/ipc/contract/b.ts'));
    bad(check('presentation/ipc/contract/a.ts', 'presentation/ipc/client/b.ts'));
    bad(check('presentation/ipc/contract/a.ts', 'feature/tags/services/index.ts'));
    ok(check('presentation/ipc/contract/a.ts', 'feature/tags/types/index.ts'));
  });

  it('lets ipc see ports of features and keeps ipc/client and contract off them', () => {
    ok(check('presentation/ipc/publisher.ts', 'feature/tags/ports/index.ts'));
    ok(check('presentation/ipc/views/a.ts', 'feature/tags/ports/index.ts'));
    bad(check('presentation/ipc/client/a.ts', 'feature/tags/ports/index.ts'));
    bad(check('presentation/ipc/contract/a.ts', 'feature/tags/ports/index.ts'));
  });

  it('lets format serve mcp and cli, and not the reverse', () => {
    ok(check('presentation/mcp/a.ts', 'presentation/format/b.ts'));
    ok(check('presentation/cli/a.ts', 'presentation/format/b.ts'));
    bad(check('presentation/format/a.ts', 'presentation/mcp/b.ts'));
    bad(check('presentation/format/a.ts', 'presentation/cli/b.ts'));
  });

  it('forbids daemon clients to import ipc/views, handlers and server', () => {
    for (const area of ['views', 'handlers/x', 'server']) {
      bad(check('presentation/cli/a.ts', `presentation/ipc/${area}.ts`));
      bad(check('presentation/mcp/a.ts', `presentation/ipc/${area}.ts`));
      bad(check('presentation/web/a.ts', `presentation/ipc/${area}.ts`));
    }
    ok(check('presentation/ipc/handlers/a.ts', 'presentation/ipc/views/b.ts'));
  });

  it('does not let mcp, web or format import cli', () => {
    bad(check('presentation/mcp/a.ts', 'presentation/cli/b.ts'));
    bad(check('presentation/web/a.ts', 'presentation/cli/b.ts'));
  });

  it('lets cli reach mcp and web only through index.ts', () => {
    ok(check('presentation/cli/a.ts', 'presentation/web/index.ts'));
    ok(check('presentation/cli/a.ts', 'presentation/mcp/index.ts'));
    bad(check('presentation/cli/a.ts', 'presentation/web/server.ts'));
    const dynamic = makeTree({
      'presentation/cli/a.ts': `export const load = () => import('../web/server.ts');\n`,
      'presentation/web/server.ts': stub,
    });
    expect(importViolations(dynamic)).toHaveLength(1);
  });

  it('lets cli see app and services of swarm-config only', () => {
    ok(check('presentation/cli/a.ts', 'app/b.ts'));
    ok(check('presentation/cli/a.ts', 'feature/swarm-config/services/index.ts'));
    bad(check('presentation/cli/a.ts', 'feature/runs/services/index.ts'));
    bad(check('presentation/mcp/a.ts', 'app/b.ts'));
    bad(check('presentation/web/a.ts', 'feature/swarm-config/services/index.ts'));
  });

  it('reports an unknown sublayer', () => {
    bad(check('presentation/odd/a.ts', 'platform/git/b.ts'));
  });
});

describe('importViolations: old layers get a subpath of a new layer', () => {
  it('allows only the listed directory', async () => {
    const rules = await import('./rules.ts');
    rules.oldLayers['probe'] = ['platform/errors'];
    try {
      ok(check('probe/a.ts', 'platform/errors/b.ts'));
      bad(check('probe/a.ts', 'platform/git/b.ts'));
    } finally {
      delete rules.oldLayers['probe'];
    }
  });
});
