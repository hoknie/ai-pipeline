import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createClineRuntime } from '../../../src/feature/agents/clients/cline/index.ts';
import { createCopilotRuntime } from '../../../src/feature/agents/clients/copilot/index.ts';
import type { Launch } from '../../../src/feature/agents/types/index.ts';
import { conversationContext } from './conversation-context.ts';

/** Writes the files of a launch and runs its generated gate script on one request. */
function gate(launch: Launch) {
  for (const file of launch.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
  }
  const script = launch.files.find((file) => file.path.endsWith('gate.mjs'))!.path;
  return (request: unknown) => {
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify(request),
      encoding: 'utf8',
    });
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };
}

const sandbox = { AIP_COPILOT_SANDBOX_BIN: '/bin/echo' };

describe('the PreToolUse gate of Cline', () => {
  const build = (permissions: 'read' | 'edit' | 'full') => {
    const context = conversationContext('cline', {}, mkdtempSync(join(tmpdir(), 'aip-cline-')));
    context.specialist.permissions = permissions;
    context.specialist.mcp = { graph: { command: '/bin/graph', args: [], env: {} } };
    const launch = createClineRuntime().buildLaunch(context);
    const server = Object.keys(
      JSON.parse(launch.files.find((f) => f.path.endsWith('settings.json'))!.content).mcpServers,
    );
    const call = gate(launch);
    const ask = (toolName: string, parameters: Record<string, unknown>) =>
      call({ hookName: 'PreToolUse', preToolUse: { toolName, parameters } }).cancel === false;
    return { context, ask, server };
  };

  it('allows the worker, the own server and the allowed command; refuses the rest', () => {
    const { context, ask, server } = build('edit');
    const worker = server.find((name) => !name.endsWith('-graph'))!;
    expect(ask('use_mcp_tool', { server_name: worker, tool_name: 'swarm_report' })).toBe(true);
    expect(ask('use_mcp_tool', { server_name: worker, tool_name: 'swarm_split' })).toBe(false);
    expect(ask('use_mcp_tool', { server_name: `${worker}-graph`, tool_name: 'q' })).toBe(true);
    expect(ask('use_mcp_tool', { server_name: `${worker}-graph_admin`, tool_name: 'q' })).toBe(
      false,
    );
    expect(ask('use_mcp_tool', { server_name: 'jira', tool_name: 'q' })).toBe(false);
    expect(ask('execute_command', { command: 'npm test' })).toBe(true);
    expect(ask('execute_command', { command: 'npm test && rm -rf .' })).toBe(false);
    expect(ask('execute_command', { command: 'git push' })).toBe(false);
    expect(ask('write_to_file', { path: join(context.worktree, 'a.ts') })).toBe(true);
    expect(ask('write_to_file', { path: '/etc/passwd' })).toBe(false);
    expect(ask('browser_action', {})).toBe(false);
  });

  it('refuses a write and a command at the read level and a call of a broken request', () => {
    const { ask } = build('read');
    expect(ask('write_to_file', { path: 'a.ts' })).toBe(false);
    expect(ask('execute_command', { command: 'ls' })).toBe(false);
    expect(ask('read_file', { path: 'a.ts' })).toBe(true);
  });

  it('is closed when the policy is missing or the request is not JSON', () => {
    const context = conversationContext('cline', {}, mkdtempSync(join(tmpdir(), 'aip-cline-')));
    const launch = createClineRuntime().buildLaunch(context);
    const call = gate(launch);
    expect(call({ nothing: true }).cancel).toBe(true);
    const script = launch.files.find((file) => file.path.endsWith('gate.mjs'))!.path;
    const broken = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' });
    expect(JSON.parse(broken.stdout).cancel).toBe(true);
    writeFileSync(join(dirname(script), 'policy.json'), '{}');
    expect(
      call({ hookName: 'PreToolUse', preToolUse: { toolName: 'read_file', parameters: {} } })
        .cancel,
    ).toBe(true);
  });
});

describe('the pre-tool gate of Copilot', () => {
  const build = (permissions: 'read' | 'edit' | 'full') => {
    const context = conversationContext(
      'copilot',
      { environment: sandbox },
      mkdtempSync(join(tmpdir(), 'aip-copilot-')),
    );
    context.specialist.permissions = permissions;
    context.specialist.mcp = { graph: { command: '/bin/graph', args: [], env: {} } };
    const launch = createCopilotRuntime().buildLaunch(context);
    const servers = Object.keys(
      JSON.parse(launch.files.find((f) => f.path.endsWith('mcp-config.json'))!.content).mcpServers,
    );
    const call = gate(launch);
    const ask = (toolName: string, toolArgs: Record<string, unknown>) =>
      call({ cwd: context.worktree, toolName, toolArgs: JSON.stringify(toolArgs) })
        .permissionDecision === 'allow';
    return { context, ask, servers };
  };

  it('decides shell, file and MCP actions by the whole command, path and exact server', () => {
    const { context, ask, servers } = build('edit');
    const worker = servers.find((name) => !name.endsWith('-graph'))!;
    expect(ask('bash', { command: 'npm test' })).toBe(true);
    expect(ask('bash', { command: 'npm test | tee /tmp/x; git push' })).toBe(false);
    expect(ask('bash', { command: 'git checkout main' })).toBe(false);
    expect(ask('edit', { path: join(context.worktree, 'a.ts') })).toBe(true);
    expect(ask('edit', { path: join(context.worktree, '..', 'x') })).toBe(false);
    expect(ask('create', { path: '/tmp/outside' })).toBe(false);
    expect(ask(`${worker}-swarm_report`, {})).toBe(true);
    expect(ask(`${worker}-swarm_split`, {})).toBe(false);
    expect(ask(`${worker}-graph-search`, {})).toBe(true);
    expect(ask('unknown-server-tool', {})).toBe(false);
    expect(ask('some_new_tool', {})).toBe(false);
  });

  it('keeps read read-only and lets full run commands except the protected git ones', () => {
    const read = build('read');
    expect(read.ask('view', { path: join(read.context.worktree, 'a.ts') })).toBe(true);
    expect(read.ask('edit', { path: join(read.context.worktree, 'a.ts') })).toBe(false);
    expect(read.ask('bash', { command: 'ls' })).toBe(false);
    const full = build('full');
    expect(full.ask('bash', { command: 'make build' })).toBe(true);
    expect(full.ask('bash', { command: 'git push' })).toBe(false);
  });

  it('refuses everything when the arguments are not JSON', () => {
    const { context } = build('full');
    const launch = createCopilotRuntime().buildLaunch(
      conversationContext('copilot', { environment: sandbox }, context.root),
    );
    const call = gate(launch);
    expect(
      call({ cwd: context.worktree, toolName: 'bash', toolArgs: '{not json' }).permissionDecision,
    ).toBe('deny');
  });

  it('is referenced by the hook file of the private home', () => {
    const context = conversationContext('copilot', { environment: sandbox });
    const launch = createCopilotRuntime().buildLaunch(context);
    const hooks = JSON.parse(launch.files.find((f) => f.path.endsWith('hooks/aip.json'))!.content);
    expect(hooks.hooks.preToolUse[0].bash).toContain('gate.mjs');
  });
});
