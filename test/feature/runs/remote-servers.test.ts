import { describe, expect, it } from 'vitest';

import type { RemoteMcpPort } from '../../../src/feature/runs/ports/index.ts';
import {
  bridgedServers,
  connectedSpecialist,
  unavailableConnection,
  withBridges,
} from '../../../src/feature/runs/services/effects/conversations.ts';
import type { McpServer, Specialist } from '../../../src/feature/swarm-config/types/index.ts';

const registry: McpServer = { command: '', args: [], env: {}, connection: 'main' };
const graph: McpServer = { command: '/bin/graph', args: ['--x'], env: { K: 'v' } };

const port = (answers: Record<string, 'ok' | 'unavailable' | 'disabled'>): RemoteMcpPort => ({
  resolve: (_project, name) => {
    const found = answers[name] ?? 'unavailable';
    return found === 'ok' ? { ok: true } : { ok: false, reason: found };
  },
  attemptEnded: () => undefined,
});

const specialist = (mcp?: Record<string, McpServer>): Specialist =>
  ({ slug: 'plan', ...(mcp === undefined ? {} : { mcp }) }) as Specialist;

describe('servers of an attempt that go through a connection', () => {
  it('become the bridge of the attempt with the token of the attempt only', () => {
    const servers = bridgedServers(
      { registry, graph },
      ['/usr/bin/node', '/opt/aip.js'],
      'tok-1',
      '/s.sock',
    );
    expect(servers.registry).toEqual({
      command: '/usr/bin/node',
      args: [
        '/opt/aip.js',
        'mcp',
        '--remote',
        'registry',
        '--worker',
        'tok-1',
        '--socket',
        '/s.sock',
      ],
      env: {},
    });
    expect(servers.graph).toBe(graph);
    expect(JSON.stringify(servers)).not.toContain('main');
  });

  it('leave a specialist without servers as it is', () => {
    const plain = specialist();
    expect(withBridges(plain, ['aip'], 't', '/s')).toBe(plain);
    expect(withBridges(specialist({ registry }), ['aip'], 't', '/s').mcp?.registry?.args).toContain(
      '--remote',
    );
  });

  it('are refused with the name of the server and of the connection', () => {
    expect(unavailableConnection(port({ main: 'ok' }), '/app', { registry, graph })).toBeNull();
    expect(unavailableConnection(port({}), '/app', { registry })).toBe(
      'MCP server registry: connection main is not available for this project',
    );
    expect(unavailableConnection(port({ main: 'disabled' }), '/app', { registry })).toBe(
      'MCP server registry: connection main is disabled',
    );
  });

  it('are checked after the environment is expanded, and the connection is kept', () => {
    const ok = connectedSpecialist(
      port({ main: 'ok' }),
      '/app',
      specialist({ registry, graph }),
      {},
    );
    expect(ok).toMatchObject({ specialist: { mcp: { registry: { connection: 'main' } } } });
    const refused = connectedSpecialist(port({}), '/app', specialist({ registry }), {});
    expect(refused).toEqual({
      error: 'MCP server registry: connection main is not available for this project',
    });
    const missing = connectedSpecialist(
      port({ main: 'ok' }),
      '/app',
      specialist({ graph: { ...graph, env: { K: '${NOPE}' } } }),
      {},
    );
    expect(missing).toEqual({ error: 'MCP server graph: environment variable NOPE is not set' });
  });
});
