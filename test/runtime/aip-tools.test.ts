import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { OBSERVER_SPECIALIST, findSpecialist } from '../../src/feature/swarm-config/types/index.ts';
import { createWorkerServer } from '../../src/mcp/worker.ts';
import { createClaudeRuntime } from '../../src/runtime/index.ts';
import { config } from '../feature/runs/helpers.ts';

describe('aip tools of the worker server and the claude allowlist', () => {
  it('allows every tool the worker server offers', async () => {
    const server = createWorkerServer({
      token: 't',
      split: true,
      queue: true,
      send: async () => null,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => `mcp__aip__${tool.name}`);
    expect(names).toContain('mcp__aip__swarm_artifact');

    const runtime = createClaudeRuntime();
    const base = findSpecialist(config(), 'coder')!;
    for (const claudeEditMode of ['allowlist', 'accept_edits', 'auto'] as const) {
      for (const permissions of ['read', 'edit'] as const) {
        const launch = runtime.buildLaunch({
          specialist: { ...base, permissions, queue: true, allowCommands: ['npm test*'] },
          input: {
            prompt: 'p',
            groupTitle: 'g',
            stepId: 'code',
            specialistName: 'Кодировщик',
            skills: [],
            previous: [],
            feedback: null,
            humanAnswer: null,
            decisions: [],
          },
          worktree: '/w',
          attemptDirectory: '/a',
          workerCommand: ['node', 'main.js', 'mcp', '--worker', 't'],
          sessionId: '11111111-2222-3333-4444-555555555555',
          resumeSession: null,
          claudeEditMode,
          claudeMcp: 'isolated',
          claudeSettings: 'isolated',
        });
        const allowed = launch.args.slice(
          launch.args.indexOf('--allowedTools') + 1,
          launch.args.indexOf('--disallowedTools'),
        );
        for (const name of names) {
          expect(allowed, `${claudeEditMode}/${permissions}`).toContain(name);
        }
      }
    }
  });

  it('allows the repair tools of the observer only', async () => {
    const server = createWorkerServer({
      token: 't',
      split: false,
      repair: true,
      send: async () => null,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => `mcp__aip__${tool.name}`);
    expect(names).toContain('mcp__aip__swarm_repair_cancel');

    const runtime = createClaudeRuntime();
    const base = findSpecialist(config(), 'coder')!;
    const allowedFor = (
      slug: string,
      permissions: 'read' | 'edit',
      claudeEditMode: 'allowlist',
    ) => {
      const launch = runtime.buildLaunch({
        specialist: { ...base, slug, permissions },
        input: {
          prompt: 'p',
          groupTitle: 'g',
          stepId: 'code',
          specialistName: 'Наблюдатель',
          skills: [],
          previous: [],
          feedback: null,
          humanAnswer: null,
          decisions: [],
        },
        worktree: '/w',
        attemptDirectory: '/a',
        workerCommand: ['node', 'main.js', 'mcp', '--worker', 't', '--repair'],
        sessionId: '11111111-2222-3333-4444-555555555555',
        resumeSession: null,
        claudeEditMode,
        claudeMcp: 'isolated',
        claudeSettings: 'isolated',
      });
      return launch.args.slice(
        launch.args.indexOf('--allowedTools') + 1,
        launch.args.indexOf('--disallowedTools'),
      );
    };
    for (const permissions of ['read', 'edit'] as const) {
      const allowed = allowedFor(OBSERVER_SPECIALIST, permissions, 'allowlist');
      for (const name of names) expect(allowed).toContain(name);
      const ordinary = allowedFor('coder', permissions, 'allowlist');
      expect(ordinary.filter((name) => name.includes('swarm_repair'))).toEqual([]);
    }
  });
});
