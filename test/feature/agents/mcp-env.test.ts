import { describe, expect, it } from 'vitest';

import { expandMcpServers } from '../../../src/feature/agents/types/index.ts';

const github = {
  command: 'gh',
  args: ['--token=${TOKEN}', '$${HOME}'],
  env: { TOKEN: '${GITHUB_TOKEN}', PLAIN: 'x', MIX: 'a-${A}-${B}' },
};

describe('expandMcpServers', () => {
  it('substitutes references in args and env and unescapes the double dollar', () => {
    const result = expandMcpServers(
      { github },
      { TOKEN: 't', GITHUB_TOKEN: 'abc', A: '1', B: '2' },
    );
    expect(result).toEqual({
      ok: true,
      servers: {
        github: {
          command: 'gh',
          args: ['--token=t', '${HOME}'],
          env: { TOKEN: 'abc', PLAIN: 'x', MIX: 'a-1-2' },
        },
      },
    });
  });

  it('names the server and the variable that is not set, and keeps the input', () => {
    const result = expandMcpServers({ github }, { TOKEN: 't', A: '1' });
    expect(result).toEqual({
      ok: false,
      error: 'MCP server github: environment variable GITHUB_TOKEN is not set',
    });
    expect(github.env.TOKEN).toBe('${GITHUB_TOKEN}');
  });

  it('takes an empty variable as set', () => {
    const result = expandMcpServers(
      { s: { command: 'x', args: [], env: { K: '${E}' } } },
      { E: '' },
    );
    expect(result).toEqual({
      ok: true,
      servers: { s: { command: 'x', args: [], env: { K: '' } } },
    });
  });
});
