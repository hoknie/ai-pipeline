import { describe, expect, it } from 'vitest';
import { createAgyRuntime } from '../../../src/feature/agents/clients/agy/index.ts';
import { defaultRuntimes } from '../../../src/feature/swarm-config/types/index.ts';
import { agyContext } from './agy-context.ts';
import { runtimeFor } from './helpers.ts';

describe('agy launches', () => {
  const runtime = createAgyRuntime('/bin/agy', { args: ['--effort', 'high'], env: { A: 'b' } });
  it('passes model, input, leading arguments and environment without continuing a random conversation', () => {
    const context = agyContext();
    context.specialist.model = 'custom/model';
    const launch = runtime.buildLaunch(context);
    expect(launch.command).toBe('/bin/agy');
    expect(launch.args.slice(0, 3)).toEqual(['--effort', 'high', '-p']);
    expect(launch.args[3]).toContain('Implement login');
    expect(launch.args[3]).toContain('aip-fresh-id');
    expect(launch.args).toContain('custom/model');
    expect(launch.args).toContain('stream-json');
    expect(launch.args).not.toContain('--continue');
    expect(launch.args).not.toContain('--conversation');
    expect(launch.env).toEqual({ A: 'b' });
    expect(launch.sessionId).toBeNull();
  });

  it('resumes only the saved conversation and leaves an unspecified model to agy', () => {
    const launch = runtime.buildLaunch(agyContext('/state', { resumeSession: 'conv-1' }));
    expect(launch.args.slice(-2)).toEqual(['--conversation', 'conv-1']);
    expect(launch.args).not.toContain('--model');
    expect(launch.sessionId).toBe('conv-1');
  });

  it('keeps worker secrets outside the worktree and separates each attempt', () => {
    const first = runtime.buildLaunch(agyContext());
    const second = runtime.buildLaunch(
      agyContext('/other', { sessionId: 'next-id', resumeSession: 'conv-1' }),
    );
    for (const launch of [first, second]) {
      expect(launch.files.every((file) => !file.path.includes('/worktree/'))).toBe(true);
      const mcp = JSON.parse(
        launch.files.find((file) => file.path.endsWith('mcp_config.json'))!.content,
      );
      const [server] = Object.values(mcp.mcpServers) as {
        enabledTools: string[];
        tools: unknown;
      }[];
      expect(server?.enabledTools).toEqual([
        'swarm_report',
        'swarm_artifact',
        'swarm_run_show',
        'swarm_split',
      ]);
    }
    expect(first.files.map((file) => file.path)).not.toEqual(second.files.map((file) => file.path));
    expect(second.args.join(' ')).toContain('aip-next-id');
  });

  it('rewrites the same hook policy for every attempt of a group, so a resumed conversation sees the current one', () => {
    const paths = (seq: number, sessionId: string) =>
      runtime
        .buildLaunch(
          agyContext('/state', {
            attemptDirectory: `/state/logs/run/login/${seq}`,
            sessionId,
            resumeSession: seq > 2 ? 'conv-1' : null,
          }),
        )
        .files.map((file) => file.path);
    expect(paths(3, 'next-id')).toEqual(paths(2, 'fresh-id'));
    expect(paths(3, 'next-id')).toContain('/state/logs/run/login/agy/policy.json');
  });

  it('uses the worker flags for queue and observer tools', () => {
    const context = agyContext();
    context.workerCommand.push('--queue', '--repair');
    const launch = runtime.buildLaunch(context);
    const policy = JSON.parse(
      launch.files.find((file) => file.path.endsWith('/policy.json'))!.content,
    );
    expect(policy.tools).toContain('swarm_queue_add');
    expect(policy.tools).toContain('swarm_repair_retry');
  });

  it('takes the environment executable over the settings and preserves args for naming too', () => {
    const settings = defaultRuntimes();
    settings.agy = {
      command: '/configured/agy',
      enabled: null,
      args: ['--effort', 'high'],
      env: { A: '1' },
    };
    expect(runtimeFor('agy', {}, settings).executable).toBe('/configured/agy');
    const adapter = runtimeFor('agy', { AIP_AGY_BIN: '/override/agy' }, settings);
    const launch = adapter.buildOneShot({
      directory: '/tmp/naming',
      prompt: 'Name',
      model: 'custom',
    });
    expect(launch.command).toBe('/override/agy');
    expect(launch.args.slice(0, 2)).toEqual(['--effort', 'high']);
    expect(launch.env).toEqual({ A: '1' });
    expect(
      JSON.parse(launch.files.find((file) => file.path.endsWith('policy.json'))!.content)
        .permissions,
    ).toBe('none');
  });
});
