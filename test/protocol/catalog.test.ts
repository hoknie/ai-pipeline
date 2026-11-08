import { describe, expect, it } from 'vitest';

import { configCatalogResponseSchema } from '../../src/presentation/ipc/contract/index.ts';

const empty = { tools: [], skills: [] };

describe('configCatalogResponseSchema', () => {
  it('parses a catalog', () => {
    const value = {
      repository: '/r',
      mcpInherited: true,
      runtimes: {
        claude: { tools: [{ name: 'Read', source: 'builtin' }], skills: [] },
        opencode: empty,
        agy: empty,
      },
    };
    expect(configCatalogResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects an unknown source', () => {
    const value = {
      repository: '/r',
      mcpInherited: false,
      runtimes: {
        claude: { tools: [{ name: 'x', source: 'plugin' }], skills: [] },
        opencode: empty,
        agy: empty,
      },
    };
    expect(configCatalogResponseSchema.safeParse(value).success).toBe(false);
  });
});
