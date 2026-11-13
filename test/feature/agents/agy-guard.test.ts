import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { createAgyRuntime } from '../../../src/feature/agents/clients/agy/index.ts';
import { agyToolDecision } from '../../../src/feature/agents/clients/agy/guard.ts';
import { agyContext } from './agy-context.ts';

const root = mkdtempSync(join(tmpdir(), 'aip-agy-guard-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function guard(
  permissions: 'read' | 'edit' | 'full',
  allowCommands = ['npm test'],
  servers: string[] = [],
) {
  const context = agyContext(join(root, [permissions, ...servers].join('-')));
  if (servers.length > 0) {
    context.specialist.mcp = Object.fromEntries(
      servers.map((name) => [name, { command: '/bin/' + name, args: [], env: {} }]),
    );
  }
  context.specialist.permissions = permissions;
  context.specialist.allowCommands = allowCommands;
  mkdirSync(context.worktree, { recursive: true });
  const launch = createAgyRuntime().buildLaunch(context);
  for (const file of launch.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
  }
  const script = launch.files.find((file) => file.path.endsWith('.mjs'))!.path;
  const policy = JSON.parse(readFileSync(join(dirname(script), 'policy.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  return {
    context,
    script,
    policy,
    decide(name: string, args: Record<string, unknown> = {}) {
      return agyToolDecision(policy, { toolCall: { name, args } });
    },
  };
}

describe('MCP servers of the specialist in the agy hook', () => {
  const worker = 'aip-fresh-id';
  const single = guard('read', [], ['graph']);
  const pair = guard('read', [], ['graph', 'graph_admin']);

  it('allows a tool of an own server in both forms, also on read', () => {
    expect(single.decide(`mcp_${worker}-graph_find`).decision).toBe('auto_approve');
    expect(
      single.decide('call_mcp_tool', { ServerName: `${worker}-graph`, ToolName: 'find' }).decision,
    ).toBe('auto_approve');
    expect(single.decide('list_resources', { ServerName: `${worker}-graph` }).decision).toBe(
      'auto_approve',
    );
    expect(single.decide(`mcp_${worker}_swarm_report`).decision).toBe('auto_approve');
  });

  it('denies a server that the specialist does not have', () => {
    expect(single.decide('mcp_jira_find').decision).toBe('deny');
    expect(single.decide('call_mcp_tool', { ServerName: 'jira', ToolName: 'find' }).decision).toBe(
      'deny',
    );
    expect(single.decide('read_resource', { ServerName: 'jira' }).decision).toBe('deny');
    expect(single.decide(`mcp_${worker}_find`).decision).toBe('deny');
  });

  it('keeps graph apart from a similar graph_admin of the user', () => {
    for (const [name, args] of [
      ['mcp_graph_admin_x', {}],
      ['mcp_graph_x', {}],
      ['call_mcp_tool', { ServerName: 'graph_admin', ToolName: 'x' }],
      ['call_mcp_tool', { ServerName: 'graph', ToolName: 'x' }],
    ] as const) {
      expect(single.decide(name, { ...args }).decision, name).toBe('deny');
    }
    // The name of the attempt makes the match exact: the tool is admin_x of the own graph.
    expect(single.decide(`mcp_${worker}-graph_admin_x`).decision).toBe('auto_approve');
  });

  it('attributes every call to its own server when both names are allowed', () => {
    expect(pair.decide(`mcp_${worker}-graph_admin_x`).decision).toBe('auto_approve');
    expect(pair.decide(`mcp_${worker}-graph_admin_x`).decision).toBe('auto_approve');
    expect(
      pair.decide('call_mcp_tool', { ServerName: `${worker}-graph_admin`, ToolName: 'x' }).decision,
    ).toBe('auto_approve');
    expect(pair.decide(`mcp_${worker}-graph_x`).decision).toBe('auto_approve');
    expect(pair.decide(`mcp_${worker}-other_x`).decision).toBe('deny');
  });

  it('treats an older policy without servers as an empty list', () => {
    const { servers: _servers, ...older } = single.policy;
    expect(
      agyToolDecision(older, { toolCall: { name: `mcp_${worker}-graph_find`, args: {} } }).decision,
    ).toBe('deny');
    expect(
      agyToolDecision(older, { toolCall: { name: `mcp_${worker}_swarm_report`, args: {} } })
        .decision,
    ).toBe('auto_approve');
  });
});

describe('the generated agy permission hook', () => {
  const editor = guard('edit');
  const reader = guard('read');
  const full = guard('full');
  it('allows an exact command but not its longer prefix match', () => {
    const decide = (text: string) =>
      editor.decide('run_command', { CommandLine: text, Cwd: editor.context.worktree }).decision;
    expect(decide('npm test')).toBe('auto_approve');
    for (const command of [
      'npm test -- --update',
      'npm testing',
      'rm -rf target',
      'npm test && rm a',
      'npm test & rm a',
      'npm test $(touch x)',
      'npm test > /outside/x',
    ])
      expect(decide(command), command).toBe('deny');
    expect(decide('npm test && npm test')).toBe('auto_approve');
  });

  it('supports a trailing wildcard and never authorizes a protected git command', () => {
    const wildcard = guard('edit', ['npm test*', 'git *']);
    const decide = (text: string) =>
      wildcard.decide('run_command', { CommandLine: text, Cwd: wildcard.context.worktree })
        .decision;
    expect(decide('npm test -- --runInBand')).toBe('auto_approve');
    for (const command of [
      'git push origin main',
      'git checkout main',
      'git switch main',
      'git -C /outside push',
      'npm test; git push',
      'env git push',
    ])
      expect(decide(command), command).toBe('deny');
    expect(decide('git diff')).toBe('auto_approve');
  });

  it('restricts direct writes including dangling symlinks and nonexisting files', () => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(editor.context.worktree, 'external'));
    symlinkSync(join(outside, 'missing.txt'), join(editor.context.worktree, 'dangling'));
    const write = (path: string) => editor.decide('write_to_file', { TargetFile: path }).decision;
    expect(write(join(editor.context.worktree, 'new', 'file.ts'))).toBe('auto_approve');
    for (const path of [
      outside,
      join(editor.context.worktree, 'external', 'new.ts'),
      join(editor.context.worktree, 'dangling'),
      join(dirname(editor.context.attemptDirectory), 'agy', 'policy.json'),
    ])
      expect(write(path), path).toBe('deny');
  });

  it('keeps read-only writes and shell denied but permits the current worker', () => {
    expect(
      reader.decide('view_file', { AbsolutePath: join(reader.context.worktree, 'x') }).decision,
    ).toBe('auto_approve');
    expect(
      reader.decide('view_file', { AbsolutePath: join(root, 'outside', 'secret') }).decision,
    ).toBe('deny');
    expect(
      reader.decide('write_to_file', { TargetFile: join(reader.context.worktree, 'x') }).decision,
    ).toBe('deny');
    expect(
      reader.decide('run_command', { CommandLine: 'npm test', Cwd: reader.context.worktree })
        .decision,
    ).toBe('deny');
    expect(reader.decide('mcp_aip-fresh-id_swarm_report').decision).toBe('auto_approve');
    expect(
      reader.decide('call_mcp_tool', { ServerName: 'aip-fresh-id', ToolName: 'swarm_report' })
        .decision,
    ).toBe('auto_approve');
    for (const name of [
      'mcp_aip-old_swarm_report',
      'mcp_aip-fresh-id_swarm_queue_add',
      'invoke_subagent',
      'manage_task',
      'ask_permission',
    ])
      expect(reader.decide(name).decision, name).toBe('deny');
  });

  it('understands the tool names agy actually sends', () => {
    expect(
      reader.decide('read_file', { Path: join(reader.context.worktree, 'CLAUDE.md') }).decision,
    ).toBe('auto_approve');
    expect(reader.decide('read_file', { Path: join(root, 'outside', 'secret') }).decision).toBe(
      'deny',
    );
    expect(editor.decide('run_command', { CommandLine: 'npm test' }).decision).toBe('auto_approve');
    expect(editor.decide('run_command', { CommandLine: 'rm -rf target' }).decision).toBe('deny');
    expect(reader.decide('run_command', { CommandLine: 'npm test' }).decision).toBe('deny');
    for (const name of ['write_file', 'edit_file']) {
      const inside = { Path: join(editor.context.worktree, 'src', 'a.ts') };
      expect(editor.decide(name, inside).decision, name).toBe('auto_approve');
      expect(editor.decide(name, { Path: join(root, 'outside', 'b.ts') }).decision, name).toBe(
        'deny',
      );
      expect(editor.decide(name, { TargetFile: inside.Path }).decision, name).toBe('deny');
      expect(reader.decide(name, inside).decision, name).toBe('deny');
    }
    for (const name of ['list_resources', 'read_resource']) {
      expect(reader.decide(name, { ServerName: 'aip-fresh-id' }).decision, name).toBe(
        'auto_approve',
      );
      expect(reader.decide(name, { ServerName: 'other' }).decision, name).toBe('deny');
    }
  });

  it('does not let broad user grants or an outside Cwd replace the policy', () => {
    const request = {
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'rm -rf target', Cwd: editor.context.worktree },
      },
      permissions: { allow: ['command(*)'] },
    };
    expect(agyToolDecision(editor.policy, request).decision).toBe('deny');
    const result = spawnSync(process.execPath, [editor.script], {
      encoding: 'utf8',
      input: JSON.stringify({ toolCall: request.toolCall }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).decision).toBe('deny');
    expect(editor.decide('run_command', { CommandLine: 'npm test', Cwd: root }).decision).toBe(
      'deny',
    );
    expect(
      full.decide('run_command', { CommandLine: 'npm install', Cwd: full.context.worktree })
        .decision,
    ).toBe('auto_approve');
    expect(
      full.decide('run_command', { CommandLine: 'git push', Cwd: full.context.worktree }).decision,
    ).toBe('deny');
  });

  it('fails closed for malformed input or policy', () => {
    expect(agyToolDecision({}, { toolCall: { name: 'view_file', args: {} } }).decision).toBe(
      'deny',
    );
    const result = spawnSync(process.execPath, [reader.script], {
      encoding: 'utf8',
      input: 'not json',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).decision).toBe('deny');
    const policy = join(dirname(reader.script), 'policy.json');
    const saved = readFileSync(policy, 'utf8');
    writeFileSync(policy, '{}');
    const invalid = JSON.parse(readFileSync(policy, 'utf8')) as unknown;
    expect(agyToolDecision(invalid, { toolCall: { name: 'view_file', args: {} } }).decision).toBe(
      'deny',
    );
    writeFileSync(policy, saved);
  });

  it('denies every tool in a one-shot naming request', () => {
    const launch = createAgyRuntime().buildOneShot({
      directory: join(root, 'naming'),
      prompt: 'Name',
      model: 'custom',
    });
    for (const file of launch.files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content);
    }
    const script = launch.files.find((file) => file.path.endsWith('.mjs'))!.path;
    const policy = JSON.parse(readFileSync(join(dirname(script), 'policy.json'), 'utf8'));
    for (const name of ['run_command', 'write_to_file', 'view_file', 'call_mcp_tool'])
      expect(agyToolDecision(policy, { toolCall: { name, args: {} } }).decision, name).toBe('deny');
  });
});
