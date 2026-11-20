import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  commitEdit,
  editorView,
  planMcpServer,
  revisionOf,
} from '../../../src/feature/swarm-edit/services/index.ts';
import {
  ConfigEditError,
  type EditPlan,
  type McpServerValue,
} from '../../../src/feature/swarm-edit/types/index.ts';
import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import { type ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-mcp-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function put(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const server = (overrides: Partial<McpServerValue> = {}): McpServerValue => ({
  command: '/bin/graph',
  args: [],
  env: {},
  allSpecialists: false,
  ...overrides,
});

function committed(plan: EditPlan): void {
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  commitEdit(plan);
}

const SPECIALIST = 'name: Plan\n';

describe('the catalog of MCP servers in the editor view', () => {
  it('shows a project server over a global one without the values of env', () => {
    const paths = setup();
    const globalFile = join(paths.global.directory, 'settings.yaml');
    const projectFile = join(paths.project.directory, 'settings.yaml');
    put(
      globalFile,
      'mcp_servers:\n  graph: { command: /bin/graph, args: [--x] }\n  github: { command: gh, env: { TOKEN: ghp_secret } }\n',
    );
    put(
      projectFile,
      'mcp_servers:\n  graph: { command: /opt/graph, all_specialists: true, env: { KEY: project_secret } }\n',
    );
    put(
      join(paths.project.directory, 'specialists', 'plan.yaml'),
      'name: Plan\nmcp_servers: [github]\n',
    );
    put(join(paths.project.directory, 'specialists', 'coder.yaml'), SPECIALIST);
    const view = editorView(paths);
    expect(view.mcpServers).toEqual([
      {
        name: 'github',
        command: 'gh',
        args: [],
        envNames: ['TOKEN'],
        allSpecialists: false,
        level: 'global',
        file: globalFile,
        specialists: ['plan'],
        shared: { command: 'gh', args: [], envNames: ['TOKEN'], allSpecialists: false },
      },
      {
        name: 'graph',
        command: '/opt/graph',
        args: [],
        envNames: ['KEY'],
        allSpecialists: true,
        level: 'project_over_global',
        file: projectFile,
        specialists: ['coder', 'plan'],
        shared: { command: '/bin/graph', args: ['--x'], envNames: [], allSpecialists: false },
      },
    ]);
    expect(JSON.stringify(view.mcpServers)).not.toContain('ghp_secret');
    expect(JSON.stringify(view.mcpServers)).not.toContain('project_secret');
  });

  it('gives the mcp field of a specialist as it is in its file', () => {
    const paths = setup();
    put(
      join(paths.project.directory, 'specialists', 'plan.yaml'),
      'name: Plan\nmcp:\n  graph:\n    command: /bin/graph\n    env: { TOKEN: "${GRAPH_TOKEN}" }\n',
    );
    const plan = editorView(paths).specialists.find((item) => item.slug === 'plan');
    expect(plan?.raw.mcp).toEqual({
      graph: { command: '/bin/graph', env: { TOKEN: '${GRAPH_TOKEN}' } },
    });
  });
});

describe('writing a server of the catalog', () => {
  it('adds a global server and keeps comments and other keys', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    put(file, '# my settings\nmax: 2 # at once\n');
    const projectFile = join(paths.project.directory, 'settings.yaml');
    put(projectFile, 'max: 4\n');
    committed(
      planMcpServer(paths, {
        name: 'graph',
        value: server({ allSpecialists: true, args: ['--x'] }),
        revision: revisionOf(readFileSync(file, 'utf8')),
        level: 'global',
      }),
    );
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('# my settings');
    expect(text).toContain('max: 2 # at once');
    expect(text).toContain('mcp_servers:');
    expect(text).toContain('all_specialists: true');
    expect(readFileSync(projectFile, 'utf8')).toBe('max: 4\n');
    expect(editorView(paths).mcpServers[0]).toMatchObject({ name: 'graph', args: ['--x'] });
  });

  it('keeps the value of a variable sent without one and drops an omitted variable', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    put(file, 'mcp_servers:\n  github:\n    command: gh\n    env: { TOKEN: ghp_secret, OLD: x }\n');
    const plan = planMcpServer(paths, {
      name: 'github',
      value: server({ command: 'gh', args: ['--new'], env: { TOKEN: null } }),
      revision: revisionOf(readFileSync(file, 'utf8')),
      level: 'global',
    });
    committed(plan);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('ghp_secret');
    expect(text).toContain('--new');
    expect(text).not.toContain('OLD');
    expect(
      JSON.stringify(plan.ok ? { file: plan.file, revision: plan.revision } : plan),
    ).not.toContain('ghp_secret');
  });

  it('refuses a kept variable that the file does not have', () => {
    const paths = setup();
    const plan = planMcpServer(paths, {
      name: 'github',
      value: server({ env: { TOKEN: null } }),
      revision: null,
      level: 'global',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.mcp_servers.github.env.TOKEN' }],
    });
  });

  it('refuses a command that is not a name or an absolute path', () => {
    const plan = planMcpServer(setup(), {
      name: 'graph',
      value: server({ command: 'bin/graph' }),
      revision: null,
      level: 'global',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.mcp_servers.graph.command' }],
    });
  });

  it('reports a conflict after an outside change', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    put(file, 'max: 2\n');
    const stale = revisionOf('max: 1\n');
    expect(
      planMcpServer(paths, { name: 'graph', value: server(), revision: stale, level: 'global' }),
    ).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('refuses a name that could leave the key', () => {
    expect(() =>
      planMcpServer(setup(), { name: '../x', value: server(), revision: null, level: 'global' }),
    ).toThrow(ConfigEditError);
  });
});

describe('removing a server of the catalog', () => {
  it('refuses a server that a specialist names and keeps the file', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    put(file, 'mcp_servers:\n  github: { command: gh }\n');
    put(
      join(paths.project.directory, 'specialists', 'plan.yaml'),
      'name: Plan\nmcp_servers: [github]\n',
    );
    const before = readFileSync(file, 'utf8');
    const plan = planMcpServer(paths, {
      name: 'github',
      value: null,
      revision: revisionOf(before),
      level: 'global',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.specialists.plan.mcp_servers[0]' }],
    });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('removes a free server and the empty section', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    put(file, 'max: 2\nmcp_servers:\n  github: { command: gh }\n');
    committed(
      planMcpServer(paths, {
        name: 'github',
        value: null,
        revision: revisionOf(readFileSync(file, 'utf8')),
        level: 'global',
      }),
    );
    expect(readFileSync(file, 'utf8')).toBe('max: 2\n');
  });

  it('allows removing a global server that the project level still defines', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    put(file, 'mcp_servers:\n  github: { command: gh }\n');
    put(
      join(paths.project.directory, 'settings.yaml'),
      'mcp_servers:\n  github: { command: gh2 }\n',
    );
    put(
      join(paths.project.directory, 'specialists', 'plan.yaml'),
      'name: Plan\nmcp_servers: [github]\n',
    );
    expect(
      planMcpServer(paths, {
        name: 'github',
        value: null,
        revision: revisionOf(readFileSync(file, 'utf8')),
        level: 'global',
      }),
    ).toMatchObject({ ok: true });
  });
});
