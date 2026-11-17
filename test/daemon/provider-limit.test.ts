import { afterEach, describe, expect, it } from 'vitest';

import type { ProvidersView } from '../../src/presentation/ipc/contract/index.ts';

import { harness, until, type Harness } from './harness.ts';

const CONFIG = `swarm:
  max: 3
  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
  chains:
    coding:
      name: Coding
      mode: by_provider
      runtimes:
        - { provider: anthropic, runtime: claude, model: opus }
        - { provider: zai, runtime: claude, model: sonnet }
  specialists:
    coder: { name: Coder, runtime_chain: coding }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

/** The clock of the daemon runs this many ms ahead of the wall clock. */
let skewMs = 0;

const limitOf = async (h: Harness, slug: string): Promise<number | null | undefined> => {
  const view = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
  return view.providers.find((provider) => provider.slug === slug)?.limitUntil;
};

async function limited(resetSeconds: number): Promise<Harness> {
  skewMs = 0;
  current = await harness(CONFIG, {}, { now: () => Date.now() + skewMs });
  const h = current;
  h.script({ code: [{ usageLimit: { resetsAt: Math.ceil(Date.now() / 1000) + resetSeconds } }] });
  await h.call('run', {
    repository: h.repo,
    pipeline: 'feature',
    groups: [{ title: 'g1', task: 'task 1' }],
    provider: 'zai',
  });
  await until('zai hit the limit', async () => (await limitOf(h, 'zai')) !== null);
  return h;
}

describe('limitUntil in config_providers', () => {
  it('is the moment the limit of the provider lifts, and null for the others', async () => {
    const h = await limited(3600);
    const until = (await limitOf(h, 'zai')) as number;
    expect(until).toBeGreaterThan(Date.now() + 3_000_000);
    expect(await limitOf(h, 'anthropic')).toBeNull();
  });

  it('is null once the reset has passed', async () => {
    const h = await limited(3600);
    skewMs = 2 * 3600 * 1000;
    expect(await limitOf(h, 'zai')).toBeNull();
  });
});
