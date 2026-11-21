import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ProvidersView, QueueView } from '../../src/presentation/ipc/contract/index.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { writeLevelDirectory } from '../fixtures/config.ts';
import { startRun, type Harness } from './harness.ts';
import { WORKER_QUEUE_CONFIG, add, queueOf, start } from './queue-harness.ts';

const PROVIDERS = `  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: claude }] }
`;

/** The harness configuration with the providers and a `default_provider` line. */
const withDefault = (config: string, slug: string | null): string => {
  const head = 'swarm:\n';
  const extra = `${PROVIDERS}${slug === null ? '' : `  default_provider: ${slug}\n`}`;
  return config.replace(head, `${head}${extra}`);
};

const CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Coder }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

const providers = async (h: Harness, params: Record<string, unknown> = {}) =>
  (await h.call('config_providers', { repository: h.repo, ...params })) as ProvidersView;

describe('a task without a provider', () => {
  it('goes to the default provider, and null keeps it without one', async () => {
    const h = await start(withDefault(CONFIG, 'zai'));
    await add(h, 'A');
    await add(h, 'B', { provider: null });
    await add(h, 'C', { provider: 'anthropic' });
    expect((await queueOf(h)).items.map((item) => item.provider)).toEqual([
      'zai',
      null,
      'anthropic',
    ]);
  });

  it('stays without a provider when the configuration has no default', async () => {
    const h = await start(withDefault(CONFIG, null));
    await add(h, 'A');
    expect((await queueOf(h)).items.map((item) => item.provider)).toEqual([null]);
  });

  it('is not put on a disabled default provider', async () => {
    const config = withDefault(CONFIG, 'zai').replace(
      'zai: { name: Z.ai,',
      'zai: { name: Z.ai, enabled: false,',
    );
    const h = await start(config);
    await add(h, 'A');
    expect((await queueOf(h)).items.map((item) => item.provider)).toEqual([null]);
  });

  it('keeps the provider of an item on edit', async () => {
    const h = await start(withDefault(CONFIG, 'zai'));
    const { item } = await add(h, 'A', { provider: null });
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      title: 'A2',
    })) as QueueView;
    expect(edited.items.map((entry) => entry.provider)).toEqual([null]);
  });

  it('takes the default provider on the run request too', async () => {
    const h = await start(withDefault(CONFIG, 'zai'));
    await h.call('queue_pause', { repository: h.repo });
    await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
      allowDuplicate: true,
    });
    const queue = await queueOf(h);
    const found = [...queue.items, ...queue.runs].map((entry) => entry.provider);
    expect(found).toEqual(['zai']);
  });

  it('is put on the default provider of every project', async () => {
    const h = await start(withDefault(CONFIG, 'zai'));
    const root = dirname(h.repo);
    const paths: Record<string, string> = {};
    for (const [name, slug] of [
      ['lib', 'zai'],
      ['web', 'anthropic'],
    ] as const) {
      paths[name] = join(root, name);
      copyTemplateRepo(paths[name], withDefault(CONFIG, slug), {
        'lib.ts': 'export const v = 1;\n',
      });
      await h.call('repository_add', { path: paths[name] });
    }
    const providersOf = async (): Promise<(string | null)[][]> =>
      Promise.all(
        Object.values(paths).map(async (repository) =>
          ((await h.call('queue', { repository })) as QueueView).items.map((item) => item.provider),
        ),
      );
    await h.call('queue_add_projects', {
      repositories: ['lib', 'web'],
      pipeline: 'feature',
      task: 'shared',
    });
    expect(await providersOf()).toEqual([['zai'], ['anthropic']]);
    await h.call('queue_add_projects', {
      repositories: ['lib', 'web'],
      pipeline: 'feature',
      task: 'shared again',
      provider: null,
    });
    expect(await providersOf()).toEqual([
      ['zai', null],
      ['anthropic', null],
    ]);
  });
});

describe('a task of a specialist', () => {
  it('goes to the default provider, not to the provider of its run', async () => {
    const h = await start(withDefault(WORKER_QUEUE_CONFIG, 'zai'));
    h.script({ code: [{ queueChain: [{ pipeline: 'feature', task: 'child', title: 'child' }] }] });
    await h.call('queue_pause', { repository: h.repo });
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'summary',
      provider: 'anthropic',
    });
    await h.waitFor(created.runId, (view) => view.finished);
    const queue = await queueOf(h);
    // the queue is running: the task of the specialist is already a run
    const tasks = [...queue.items, ...queue.runs];
    expect(tasks.map((item) => [item.title, item.provider])).toEqual([['child', 'zai']]);
  });
});

describe('config_providers', () => {
  const GLOBAL = `swarm:
  default_provider: anthropic
  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
`;

  it('answers with the project value, the shared one and null', async () => {
    const h = await start(withDefault(CONFIG, 'zai'));
    expect((await providers(h)).defaultProvider).toEqual({ slug: 'zai', level: 'project' });
    const bare = await start(withDefault(CONFIG, null));
    expect((await providers(bare)).defaultProvider).toBeNull();
  });

  it('answers with the shared level only for level global', async () => {
    const h = await start(withDefault(CONFIG, 'zai'));
    writeLevelDirectory(join(h.environment.XDG_CONFIG_HOME as string, 'aip'), GLOBAL);
    const view = await providers(h, { level: 'global' });
    expect(view.defaultProvider).toEqual({ slug: 'anthropic', level: 'global' });
  });
});
