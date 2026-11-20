import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  findSpecialist,
  withConfigDefaults,
  type FieldError,
} from '../../../src/feature/swarm-config/types/index.ts';
import { parseConfig } from '../../../src/feature/swarm-config/services/index.ts';

function errorsOf(text: string): FieldError[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return error.detail.errors;
    }
    throw error;
  }
  throw new Error('expected field errors');
}

function expectError(errors: FieldError[], path: string, fragment: string): void {
  expect(errors).toContainEqual({ path, message: expect.stringContaining(fragment) });
}

const SPECIALISTS = '  specialists:\n    plan: { name: P }\n    coder: { name: C }\n';

describe('mcp servers through a connection', () => {
  it('reads a catalog server with a connection and gives it to every specialist', () => {
    const config = parseConfig(
      `swarm:\n  mcp_servers:\n    registry: { connection: main, all_specialists: true }\n${SPECIALISTS}`,
    );
    expect(config.mcpServers.registry).toEqual({
      command: '',
      args: [],
      env: {},
      connection: 'main',
      allSpecialists: true,
    });
    for (const slug of ['plan', 'coder']) {
      expect(findSpecialist(config, slug)?.mcp).toEqual({
        registry: { command: '', args: [], env: {}, connection: 'main' },
      });
    }
  });

  it('keeps the name of the connection in the snapshot, not an address or a token', () => {
    const config = parseConfig(
      `swarm:\n  mcp_servers:\n    registry: { connection: main }\n  specialists:\n    plan: { name: P, mcp_servers: [registry] }\n`,
    );
    const restored = withConfigDefaults(JSON.parse(JSON.stringify(config)));
    expect(findSpecialist(restored, 'plan')?.mcp?.registry?.connection).toBe('main');
    expect(JSON.stringify(findSpecialist(restored, 'plan')?.mcp)).toBe(
      '{"registry":{"command":"","args":[],"env":{},"connection":"main"}}',
    );
  });

  it('takes the own server of a specialist with a connection over the catalog', () => {
    const config = parseConfig(
      'swarm:\n  mcp_servers:\n    registry: { connection: main, all_specialists: true }\n  specialists:\n    plan: { name: P, mcp: { registry: { connection: team } } }\n',
    );
    expect(findSpecialist(config, 'plan')?.mcp?.registry?.connection).toBe('team');
  });

  it('refuses command and connection together, and neither', () => {
    const errors = errorsOf(
      'swarm:\n  mcp_servers:\n    both: { command: x, connection: main }\n    none: { all_specialists: true }\n  specialists:\n    plan: { name: P, mcp: { registry: { args: [--x] } } }\n',
    );
    expectError(errors, 'swarm.mcp_servers.both', 'exactly one');
    expectError(errors, 'swarm.mcp_servers.none', 'exactly one');
    expectError(errors, 'swarm.specialists.plan.mcp.registry', 'exactly one');
  });

  it('refuses args and env next to a connection', () => {
    const errors = errorsOf(
      'swarm:\n  mcp_servers:\n    registry: { connection: main, args: [--x] }\n  specialists:\n    plan: { name: P, mcp: { registry: { connection: team, env: { A: b } } } }\n',
    );
    expectError(errors, 'swarm.mcp_servers.registry.args', 'connection');
    expectError(errors, 'swarm.specialists.plan.mcp.registry.env', 'connection');
  });

  it('refuses a reference or a wrong name as a connection', () => {
    const errors = errorsOf(
      'swarm:\n  mcp_servers:\n    a: { connection: "${REGISTRY}" }\n    b: { connection: Main }\n    c: { connection: 5 }\n',
    );
    expectError(errors, 'swarm.mcp_servers.a.connection', 'name of a connection');
    expectError(errors, 'swarm.mcp_servers.b.connection', 'name of a connection');
    expect(errors.some((error) => error.path === 'swarm.mcp_servers.c.connection')).toBe(true);
  });

  it('does not look for the connection while checking the configuration', () => {
    expect(() =>
      parseConfig(`swarm:\n  mcp_servers:\n    registry: { connection: nowhere }\n${SPECIALISTS}`),
    ).not.toThrow();
  });

  it('still reads the servers with a command as before', () => {
    const config = parseConfig(
      'swarm:\n  mcp_servers:\n    graph: { command: /bin/graph, args: [--x], env: { K: v } }\n  specialists:\n    plan: { name: P, mcp_servers: [graph] }\n',
    );
    expect(findSpecialist(config, 'plan')?.mcp?.graph).toEqual({
      command: '/bin/graph',
      args: ['--x'],
      env: { K: 'v' },
    });
  });
});
