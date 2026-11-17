import type { ConfigEditorResponse } from '../../../shared/api/types.ts';

type Entries = Pick<ConfigEditorResponse, 'chains' | 'specialists' | 'pipelines'>;

/** Where a provider is used: chains with the numbers of its items, specialists and pipelines. */
export interface ProviderUsage {
  chains: { slug: string; name: string; items: number[] }[];
  specialists: { slug: string; name: string }[];
  pipelines: { id: string; name: string; steps: string[]; split: boolean }[];
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value !== '' ? value : fallback;

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      )
    : [];

/** The entries of one level only: the shared files alone for the shared scope. */
export function levelEntries(config: Entries, scope: 'project' | 'global'): Entries {
  if (scope === 'project') return config;
  return {
    chains: config.chains.filter((entry) => entry.sources.global),
    specialists: config.specialists.filter((entry) => entry.sources.global),
    pipelines: config.pipelines.filter((entry) => entry.sources.global),
  };
}

/**
 * The chains whose items name the provider (`provider` of an item), the specialists with such a
 * chain in `runtime_chain` and the pipelines whose steps or split run such a specialist.
 */
export function providerUsage(config: Entries, provider: string): ProviderUsage {
  const chains = config.chains.flatMap((chain) => {
    const items = list(chain.raw.runtimes).flatMap((item, index) =>
      item.provider === provider ? [index + 1] : [],
    );
    return items.length === 0
      ? []
      : [{ slug: chain.slug, name: text(chain.raw.name, chain.slug), items }];
  });
  const used = new Set(chains.map((chain) => chain.slug));
  const specialists = config.specialists.flatMap((specialist) =>
    typeof specialist.raw.runtime_chain === 'string' && used.has(specialist.raw.runtime_chain)
      ? [{ slug: specialist.slug, name: text(specialist.raw.name, specialist.slug) }]
      : [],
  );
  const running = new Set(specialists.map((specialist) => specialist.slug));
  const pipelines = config.pipelines.flatMap((pipeline) => {
    const steps = list(pipeline.raw.steps).flatMap((step) =>
      typeof step.specialist === 'string' && running.has(step.specialist)
        ? [text(step.id, step.specialist)]
        : [],
    );
    const split = list([pipeline.raw.split]).some(
      (item) => typeof item.specialist === 'string' && running.has(item.specialist),
    );
    return steps.length === 0 && !split
      ? []
      : [{ id: pipeline.id, name: text(pipeline.raw.name, pipeline.id), steps, split }];
  });
  return { chains, specialists, pipelines };
}

/** Whether nothing uses the provider. */
export const isUnused = (usage: ProviderUsage): boolean =>
  usage.chains.length === 0 && usage.specialists.length === 0 && usage.pipelines.length === 0;
