import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createKiloRuntime,
  kiloPermission,
} from '../../../src/feature/agents/clients/kilo/index.ts';
import { attemptServers } from '../../../src/feature/agents/clients/policy/index.ts';
import { conversationContext } from './conversation-context.ts';

const config = (launch: { files: { path: string; content: string }[] }) =>
  JSON.parse(launch.files.find((file) => file.path.endsWith('kilo.json'))!.content);

describe('Kilo launch', () => {
  it('runs `kilo run --format json` in a private XDG home', () => {
    const context = conversationContext('kilo');
    const launch = createKiloRuntime('/bin/kilo').buildLaunch(context);
    expect(launch.args.slice(0, 3)).toEqual(['run', '--format', 'json']);
    expect(launch.args).not.toContain('--auto');
    const home = join(context.conversationDirectory!, 'xdg');
    expect(launch.env.XDG_CONFIG_HOME).toBe(join(home, 'config'));
    expect(launch.env.XDG_DATA_HOME).toBe(join(home, 'data'));
    expect(launch.env.XDG_STATE_HOME).toBe(join(home, 'state'));
    expect(launch.files[0]!.path).toBe(join(home, 'config', 'kilo', 'kilo.json'));
  });

  it('configures an OpenAI-compatible provider with {env:KEY} and no key', () => {
    const context = conversationContext('kilo', {
      environment: { AIP_KILO_BASE_URL: 'https://llm.example/v1' },
    });
    const launch = createKiloRuntime('kilo', {
      args: [],
      env: { AIP_KILO_API_KEY: 'sk-very-secret' },
    }).buildLaunch(context);
    const parsed = config(launch);
    expect(parsed.provider.aip.options).toEqual({
      baseURL: 'https://llm.example/v1',
      apiKey: '{env:AIP_KILO_API_KEY}',
    });
    expect(parsed.model).toBe('aip/team-model');
    expect(launch.args).toContain('aip/team-model');
    expect(JSON.stringify([launch.args, launch.files])).not.toContain('sk-very-secret');
    const own = createKiloRuntime().buildLaunch(
      conversationContext('kilo', { environment: { AIP_KILO_BASE_URL: 'https://x/v1' } }),
    );
    expect(config(own).provider.aip.models).toEqual({ 'team-model': { name: 'team-model' } });
  });

  it('keeps `provider/model` as the specialist wrote it without an endpoint', () => {
    const context = conversationContext('kilo');
    context.specialist.model = 'openrouter/some-model';
    const launch = createKiloRuntime().buildLaunch(context);
    expect(launch.args).toContain('openrouter/some-model');
    expect(config(launch).provider).toBeUndefined();
  });

  it('puts an explicit deny over --auto at the full level', () => {
    const context = conversationContext('kilo');
    context.specialist.permissions = 'full';
    const launch = createKiloRuntime().buildLaunch(context);
    expect(launch.args).toContain('--auto');
    const permission = config(launch).permission;
    expect(permission.bash['git push*']).toBe('deny');
    expect(permission.bash['git checkout*']).toBe('deny');
    expect(permission.bash['git switch*']).toBe('deny');
    expect(permission['*']).toBe('deny');
  });

  it('allows only the commands of the specialist at edit and none at read', () => {
    const context = conversationContext('kilo');
    const servers = attemptServers(context);
    const edit = kiloPermission(context, servers);
    expect(edit.bash).toMatchObject({ '*': 'deny', 'npm test*': 'allow', 'git push*': 'deny' });
    expect(edit.edit).toBe('allow');
    context.specialist.permissions = 'read';
    const read = kiloPermission(context, servers);
    expect(read.edit).toBe('deny');
    expect(read.bash).toEqual({ '*': 'deny' });
  });

  it('allows the exact tools of the worker and the servers of the specialist, no other server', () => {
    const context = conversationContext('kilo');
    context.specialist.mcp = { graph: { command: '/bin/graph', args: [], env: {} } };
    const permission = config(createKiloRuntime().buildLaunch(context)).permission;
    expect(permission['aip-attempt-1_swarm_report']).toBe('allow');
    expect(permission['aip-attempt-1_swarm_split']).toBeUndefined();
    expect(permission['aip-attempt-1-graph_*']).toBe('allow');
    expect(permission['jira_*']).toBeUndefined();
    expect(Object.keys(config(createKiloRuntime().buildLaunch(context)).mcp)).toEqual([
      'aip-attempt-1-graph',
      'aip-attempt-1',
    ]);
  });

  it('resumes with -s from the same XDG home and refuses a resume without a history', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-kilo-'));
    const context = conversationContext('kilo', { resumeSession: 'ses_1' }, root);
    expect(() => createKiloRuntime().buildLaunch(context)).toThrow(/history .* is missing/);
    mkdirSync(join(context.conversationDirectory!, 'xdg', 'data'), { recursive: true });
    const launch = createKiloRuntime().buildLaunch(context);
    expect(launch.args[launch.args.indexOf('-s') + 1]).toBe('ses_1');
    expect(launch.sessionId).toBe('ses_1');
  });

  it('replaces the worker with the next attempt in the same config file', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-kilo-'));
    const first = createKiloRuntime().buildLaunch(conversationContext('kilo', {}, root));
    const second = createKiloRuntime().buildLaunch(
      conversationContext('kilo', { sessionId: 'attempt-2' }, root),
    );
    expect(first.files[0]!.path).toBe(second.files[0]!.path);
    expect(second.files[0]!.content).not.toContain('aip-attempt-1');
  });

  it('reads the JSON stream like OpenCode and lists no models without a documented command', async () => {
    const runtime = createKiloRuntime();
    const parser = runtime.createParser();
    parser.push(
      JSON.stringify({ type: 'text', sessionID: 'ses_9', part: { type: 'text', text: 'hi' } }),
    );
    parser.push('noise');
    parser.push(
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', tokens: { input: 3, output: 2 } },
      }),
    );
    expect(parser.outcome()).toMatchObject({
      sessionId: 'ses_9',
      usage: { inputTokens: 3, outputTokens: 2 },
    });
    expect(await runtime.listModels('/d', () => Promise.reject(new Error('never')))).toEqual({
      models: [],
      error: null,
    });
  });
});
