import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { calls, run, start } from './control-harness.ts';
import { settle, until } from './harness.ts';
import type { ProvidersView } from '../../src/presentation/ipc/contract/index.ts';

const CONFIG = `swarm:
  max: 3
  delivery: { auto: false }
  roles:
    think: { name: Think }
  providers:
    example:
      name: Example
      access: [{ kind: cli, runtime: opencode, model_prefix: example }]
      models: { think: A }
  chains:
    role:
      name: Role
      mode: on_error
      runtimes: [{ runtime: opencode, provider: example, model_role: think }]
    fixed:
      name: Fixed
      mode: on_error
      runtimes: [{ runtime: opencode, provider: example, model: example/A }]
  specialists:
    role: { name: Role, runtime_chain: role }
    fixed: { name: Fixed, runtime_chain: fixed }
  pipelines:
    feature:
      steps:
        - { id: role, specialist: role }
        - { id: fixed, specialist: fixed }
`;

describe('chain role models at the configuration snapshot boundary', () => {
  it('keeps a global constructor provider and role global beside other project slugs', async () => {
    const h = await start(CONFIG);
    const global = join(h.environment.XDG_CONFIG_HOME!, 'aip');
    mkdirSync(join(global, 'providers'), { recursive: true });
    writeFileSync(join(global, 'settings.yaml'), 'roles: { constructor: { name: Constructor } }\n');
    const file = join(global, 'providers', 'constructor.yaml');
    writeFileSync(
      file,
      'name: Constructor\naccess: [{ kind: cli, runtime: claude }]\nmodels: { constructor: A }\n',
    );
    const registry = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
    expect(registry.errors).toEqual([]);
    expect(registry.roles.find((role) => role.slug === 'constructor')).toMatchObject({
      level: 'global',
    });
    expect(registry.roles.find((role) => role.slug === 'think')).toMatchObject({
      level: 'project',
    });
    expect(registry.providers.find((provider) => provider.slug === 'constructor')).toMatchObject({
      level: 'global',
      file,
    });
    expect(registry.providers.find((provider) => provider.slug === 'example')).toMatchObject({
      level: 'project',
    });
  });

  it.each(['runtimes: [', 'runtimes: *unknown'])(
    'serves the registry over IPC despite chain YAML %s',
    async (yaml) => {
      const h = await start(CONFIG);
      const chainFile = join(h.repo, 'aip', 'chains', 'role.yaml');
      writeFileSync(chainFile, yaml);
      const registry = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
      expect(registry.errors).toEqual([]);
      expect(registry.roles.map((role) => role.slug)).toEqual(['think']);
      expect(registry.matrix[0]?.access[0]?.model).toEqual({ model: 'example/A' });
      await expect(run(h)).rejects.toThrow(chainFile);
    },
  );

  it('serializes absent constructor cells as null, including route-only models', async () => {
    const h = await start(CONFIG);
    const settings = join(h.repo, 'aip', 'settings.yaml');
    writeFileSync(settings, readFileSync(settings, 'utf8').replace('think:', 'constructor:'));
    const provider = join(h.repo, 'aip', 'providers', 'example.yaml');
    writeFileSync(
      provider,
      `name: Example
access: [{ kind: cli, runtime: opencode, model_prefix: example, models: { constructor: A } }]
models: {}
`,
    );
    const registry = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
    expect(registry.errors).toEqual([]);
    expect(registry.matrix).toEqual([
      {
        role: 'constructor',
        provider: 'example',
        model: null,
        access: [{ index: 0, model: { model: 'example/A' } }],
      },
    ]);
    writeFileSync(
      provider,
      'name: Example\naccess: [{ kind: cli, runtime: opencode }]\nmodels: {}\n',
    );
    const empty = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
    expect(empty.errors).toEqual([]);
    expect(empty.matrix).toEqual([
      {
        role: 'constructor',
        provider: 'example',
        model: null,
        access: [{ index: 0, model: null }],
      },
    ]);
  });

  it('keeps replacement providers and roles available while a chain reference is broken', async () => {
    const h = await start(CONFIG);
    const chainFile = join(h.repo, 'aip', 'chains', 'role.yaml');
    const source = readFileSync(chainFile, 'utf8');
    writeFileSync(chainFile, source.replace('model_role: think', 'model_role: removed'));
    const registry = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
    expect(registry.errors).toEqual([]);
    expect(registry.roles.map((role) => role.slug)).toEqual(['think']);
    expect(registry.providers.map((provider) => provider.slug)).toEqual(['example']);
    expect(registry.matrix[0]?.access[0]?.model).toEqual({ model: 'example/A' });
    await expect(run(h)).rejects.toThrow('unknown role `removed`');
    writeFileSync(
      chainFile,
      source.replace('model_role: think', `model_role: ${registry.roles[0]!.slug}`),
    );
    h.script({ role: [{}], fixed: [{}] });
    const id = await run(h);
    await h.waitFor(id, (view) => view.finished);
    expect((await h.group(id, 'g1')).attempts[0]?.model).toBe('example/A');
  });

  it('loads B for a new run, keeps fixed A and never interrupts an active A attempt', async () => {
    const h = await start(CONFIG);
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    h.script({ role: [{ waitFor: h.gate('old') }, {}], fixed: [{}] });
    const old = await run(h);
    await until('the old agent', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    const chainFile = join(h.repo, 'aip', 'chains', 'role.yaml');
    const chainSource = readFileSync(chainFile, 'utf8');
    const providerFile = join(h.repo, 'aip', 'providers', 'example.yaml');
    writeFileSync(providerFile, readFileSync(providerFile, 'utf8').replace('think: A', 'think: B'));

    const fresh = await run(h);
    await h.waitFor(fresh, (view) => view.finished);
    expect((await h.group(fresh, 'g1')).attempts.map((attempt) => attempt.model)).toEqual([
      'example/B',
      'example/A',
    ]);
    await settle(h);
    const active = await h.group(old, 'g1');
    expect(active.status).toBe('running');
    expect(active.attempts).toHaveLength(1);
    expect(active.attempts[0]).toMatchObject({ model: 'example/A', status: 'running' });
    expect(readFileSync(chainFile, 'utf8')).toBe(chainSource);
    h.open('old');
    await h.waitFor(old, (view) => view.finished);
    expect((await h.group(old, 'g1')).attempts.map((attempt) => attempt.model)).toEqual([
      'example/A',
      'example/A',
    ]);
    expect(calls(h).map((call) => call.args[call.args.indexOf('-m') + 1])).toEqual([
      'example/A',
      'example/B',
      'example/A',
      'example/A',
    ]);
  });

  it('keeps A on ordinary retries and restart, accepts B only on refresh and refuses invalid refresh atomically', async () => {
    const h = await start(CONFIG);
    h.script({
      role: [{ exitCode: 1, noReport: true }, { exitCode: 1, noReport: true }, {}],
      fixed: [{}],
    });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    const providerFile = join(h.repo, 'aip', 'providers', 'example.yaml');
    const providerB = readFileSync(providerFile, 'utf8').replace('think: A', 'think: B');
    writeFileSync(providerFile, providerB);
    await h.restart();
    await h.call('retry', { runId, group: 'g1' });
    await until(
      'the ordinary retry',
      async () => (await h.group(runId, 'g1')).attempts.length === 2,
    );
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    const before = await h.group(runId, 'g1');
    expect(before.attempts.map((attempt) => attempt.model)).toEqual(['example/A', 'example/A']);
    writeFileSync(providerFile, providerB.replace('think: B', 'think: ""'));
    await expect(h.call('retry', { runId, group: 'g1', refreshConfig: true })).rejects.toThrow(
      'configuration not loaded',
    );
    expect(await h.group(runId, 'g1')).toEqual(before);
    writeFileSync(providerFile, providerB);
    await h.call('retry', { runId, group: 'g1', refreshConfig: true });
    await h.waitFor(runId, (view) => view.finished && view.groups[0]?.status === 'merged');
    const refreshed = await h.group(runId, 'g1');
    expect(refreshed.warnings).toContain('config refreshed: chains');
    expect(refreshed.attempts.slice(0, 2)).toEqual(before.attempts);
    expect((await h.group(runId, 'g1')).attempts.map((attempt) => attempt.model)).toEqual([
      'example/A',
      'example/A',
      'example/B',
      'example/A',
    ]);
  });
});
