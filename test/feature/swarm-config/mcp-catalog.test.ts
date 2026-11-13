import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  findSpecialist,
  parseReferences,
  withConfigDefaults,
  type ConfigPaths,
  type FieldError,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  configPaths,
  loadConfig,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';
import { writeLevelDirectory } from '../../fixtures/config.ts';

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

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-mcp-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

const SPECIALISTS = '  specialists:\n    plan: { name: P }\n    coder: { name: C }\n';

describe('mcp_servers catalog', () => {
  it('reads a server with the default all_specialists false', () => {
    const config = parseConfig(
      `swarm:\n  mcp_servers:\n    github: { command: github-mcp }\n${SPECIALISTS}`,
    );
    expect(config.mcpServers).toEqual({
      github: { command: 'github-mcp', args: [], env: {}, allSpecialists: false },
    });
  });

  it('rejects the reserved name, bad fields and unknown keys', () => {
    const errors = errorsOf(
      'swarm:\n  mcp_servers:\n    aip: { command: x }\n    "b c": { command: x }\n    d: { args: [] }\n    e: { command: bin/x }\n    f: { command: x, url: y }\n    g: { command: x, all_specialists: 1 }\n',
    );
    expectError(errors, 'swarm.mcp_servers.aip', 'reserved');
    expectError(errors, 'swarm.mcp_servers.b c', 'letters');
    expectError(errors, 'swarm.mcp_servers.d.command', 'required');
    expectError(errors, 'swarm.mcp_servers.e.command', 'absolute path');
    expectError(errors, 'swarm.mcp_servers.f.url', 'unknown key');
    expectError(errors, 'swarm.mcp_servers.g.all_specialists', 'true or false');
  });

  it('replaces a global server by the project one and unites different names', () => {
    const paths = temporaryPaths();
    writeLevelDirectory(
      paths.global.directory,
      'swarm:\n  mcp_servers:\n    graph: { command: /bin/graph, args: [--x] }\n    github: { command: gh }\n  specialists:\n    plan: { name: P }\n',
    );
    writeLevelDirectory(
      paths.project.directory,
      'swarm:\n  mcp_servers:\n    graph: { command: /opt/graph }\n    jira: { command: jira }\n',
    );
    const config = loadConfig(paths);
    expect(config.mcpServers.graph).toEqual({
      command: '/opt/graph',
      args: [],
      env: {},
      allSpecialists: false,
    });
    expect(Object.keys(config.mcpServers).sort()).toEqual(['github', 'graph', 'jira']);
  });
});

describe('servers of a specialist', () => {
  it('gives servers for all specialists to everyone', () => {
    const config = parseConfig(
      `swarm:\n  mcp_servers:\n    graph: { command: /bin/graph, all_specialists: true }\n${SPECIALISTS}`,
    );
    for (const slug of ['plan', 'coder']) {
      expect(findSpecialist(config, slug)?.mcp).toEqual({
        graph: { command: '/bin/graph', args: [], env: {} },
      });
    }
  });

  it('connects a server by name', () => {
    const config = parseConfig(
      'swarm:\n  mcp_servers:\n    github: { command: gh }\n  specialists:\n    plan: { name: P, mcp_servers: [github] }\n    coder: { name: C }\n',
    );
    expect(Object.keys(findSpecialist(config, 'plan')?.mcp ?? {})).toEqual(['github']);
    expect(findSpecialist(config, 'coder')?.mcp).toBeUndefined();
  });

  it('prefers the mcp field of the specialist over the catalog', () => {
    const config = parseConfig(
      'swarm:\n  mcp_servers:\n    graph: { command: /bin/graph, all_specialists: true }\n  specialists:\n    plan: { name: P, mcp: { graph: { command: /opt/graph } } }\n',
    );
    expect(findSpecialist(config, 'plan')?.mcp?.graph?.command).toBe('/opt/graph');
  });

  it('reports a name that is not in the catalog', () => {
    const errors = errorsOf('swarm:\n  specialists:\n    plan: { name: P, mcp_servers: [jira] }\n');
    expectError(errors, 'swarm.specialists.plan.mcp_servers[0]', 'unknown MCP server');
  });

  it('allows the field on any runtime and checks its type', () => {
    const config = parseConfig(
      'swarm:\n  mcp_servers:\n    g: { command: x }\n  specialists:\n    a: { name: A, runtime: agy, mcp_servers: [g] }\n',
    );
    expect(findSpecialist(config, 'a')?.mcp).toHaveProperty('g');
    expectError(
      errorsOf('swarm:\n  specialists:\n    a: { name: A, mcp_servers: x }\n'),
      'swarm.specialists.a.mcp_servers',
      'list of strings',
    );
  });
});

describe('references to environment variables', () => {
  it('keeps the reference as text', () => {
    const config = parseConfig(
      'swarm:\n  mcp_servers:\n    github:\n      command: gh\n      args: ["--token=${GITHUB_TOKEN}"]\n      env: { TOKEN: "${GITHUB_TOKEN}", RAW: "$${KEEP}" }\n',
    );
    expect(config.mcpServers.github?.env.TOKEN).toBe('${GITHUB_TOKEN}');
    expect(config.mcpServers.github?.env.RAW).toBe('$${KEEP}');
  });

  it('rejects an unclosed or invalid reference in the catalog and in mcp', () => {
    const errors = errorsOf(
      'swarm:\n  mcp_servers:\n    github: { command: gh, env: { TOKEN: "${GITHUB" }, args: ["${1X}"] }\n  specialists:\n    a: { name: A, mcp: { g: { command: x, env: { K: "${}" } } } }\n',
    );
    expectError(errors, 'swarm.mcp_servers.github.env.TOKEN', 'unclosed');
    expectError(errors, 'swarm.mcp_servers.github.args[0]', 'invalid reference');
    expectError(errors, 'swarm.specialists.a.mcp.g.env.K', 'invalid reference');
  });

  it('parses references, escapes and plain dollars', () => {
    expect(parseReferences('a${X}b')).toEqual({
      tokens: [{ text: 'a' }, { variable: 'X' }, { text: 'b' }],
    });
    expect(parseReferences('$${X} $5')).toEqual({ tokens: [{ text: '${X} $5' }] });
    expect(parseReferences('${A}${B}')).toEqual({ tokens: [{ variable: 'A' }, { variable: 'B' }] });
  });
});

describe('older snapshots', () => {
  it('get an empty catalog and keep mcp', () => {
    const stored = structuredClone(
      parseConfig('swarm:\n  specialists:\n    a: { name: A, mcp: { g: { command: x } } }\n'),
    );
    delete (stored as { mcpServers?: unknown }).mcpServers;
    const restored = withConfigDefaults(stored);
    expect(restored.mcpServers).toEqual({});
    expect(findSpecialist(restored, 'a')?.mcp).toEqual({ g: { command: 'x', args: [], env: {} } });
  });
});
