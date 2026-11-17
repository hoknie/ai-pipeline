import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  decideToolCall,
  type ToolPolicy,
} from '../../../src/feature/agents/clients/policy/index.ts';

const root = mkdtempSync(join(tmpdir(), 'aip-policy-'));
const worktree = join(root, 'worktree');
const outside = join(root, 'outside');
mkdirSync(worktree);
mkdirSync(outside);
writeFileSync(join(outside, 'secret.txt'), 'x');
symlinkSync(outside, join(worktree, 'link'));

const policy = (permissions: ToolPolicy['permissions'], extra: Partial<ToolPolicy> = {}) => ({
  worktree,
  permissions,
  allowCommands: ['npm test*'],
  server: 'aip-now',
  tools: ['swarm_report'],
  servers: ['aip-now-graph'],
  readDirectories: [],
  ...extra,
});

describe('the policy of an attempt', () => {
  it('lets read read inside the worktree and nothing else', () => {
    const read = policy('read');
    expect(decideToolCall(read, { kind: 'read', path: join(worktree, 'a.ts') }).allow).toBe(true);
    expect(decideToolCall(read, { kind: 'read', path: 'src/a.ts' }).allow).toBe(true);
    expect(decideToolCall(read, { kind: 'read', path: join(outside, 'secret.txt') }).allow).toBe(
      false,
    );
    expect(decideToolCall(read, { kind: 'write', path: join(worktree, 'a.ts') }).allow).toBe(false);
    expect(decideToolCall(read, { kind: 'shell', command: 'ls' }).allow).toBe(false);
  });

  it('keeps edit inside the worktree and inside allow_commands, also through links and ..', () => {
    const edit = policy('edit');
    expect(decideToolCall(edit, { kind: 'write', path: join(worktree, 'a.ts') }).allow).toBe(true);
    expect(decideToolCall(edit, { kind: 'write', path: join(worktree, 'link', 'x') }).allow).toBe(
      false,
    );
    expect(decideToolCall(edit, { kind: 'write', path: '../outside/x' }).allow).toBe(false);
    expect(decideToolCall(edit, { kind: 'write', path: join(outside, 'x') }).allow).toBe(false);
    expect(decideToolCall(edit, { kind: 'shell', command: 'npm test' }).allow).toBe(true);
    expect(decideToolCall(edit, { kind: 'shell', command: 'npm test && rm -rf x' }).allow).toBe(
      false,
    );
    expect(decideToolCall(edit, { kind: 'shell', command: 'npm test; git push' }).allow).toBe(
      false,
    );
    expect(decideToolCall(edit, { kind: 'shell', command: 'git push origin main' }).allow).toBe(
      false,
    );
    expect(decideToolCall(edit, { kind: 'shell', command: 'npm test', cwd: outside }).allow).toBe(
      false,
    );
  });

  it('lets full run commands but still never push, checkout or switch', () => {
    const full = policy('full');
    expect(decideToolCall(full, { kind: 'shell', command: 'make build' }).allow).toBe(true);
    for (const command of ['git push', 'git checkout main', 'git switch -c x', 'git -C . push']) {
      expect(decideToolCall(full, { kind: 'shell', command }).allow).toBe(false);
    }
  });

  it('allows exactly the tools of the worker and the servers of the specialist', () => {
    const edit = policy('read');
    const mcp = (server: string, tool: string) =>
      decideToolCall(edit, { kind: 'mcp', server, tool }).allow;
    expect(mcp('aip-now', 'swarm_report')).toBe(true);
    expect(mcp('aip-now', 'swarm_split')).toBe(false);
    expect(mcp('aip-now-graph', 'anything')).toBe(true);
    // a server that only starts with an allowed name, an old worker and a missing server
    expect(mcp('aip-now-graph_admin', 'x')).toBe(false);
    expect(mcp('aip-before', 'swarm_report')).toBe(false);
    expect(mcp('jira', 'x')).toBe(false);
    expect(mcp('', 'x')).toBe(false);
  });

  it('refuses unknown actions and a policy without a level', () => {
    expect(decideToolCall(policy('full'), { kind: 'other', name: 'browser' }).allow).toBe(false);
    expect(decideToolCall(policy('none'), { kind: 'read', path: worktree }).allow).toBe(false);
  });
});
