import type { ReasoningEffort, Runtime, SpecialistLevel } from './specialist.ts';

export const CHAIN_MODES = ['on_error', 'random', 'round_robin', 'by_provider'] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];

export interface ChainRuntimeItem {
  runtime: Runtime;
  model: string | null;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  enabled: boolean;
  /** Free provider id; the key of the limit hold, and the map key of a `by_provider` chain. */
  provider?: string;
  /** Only in a `by_provider` chain: the item of the tier chosen by default; does not change the order when no provider is requested. */
  default?: boolean;
}

export interface RuntimeChain {
  slug: string;
  name: string;
  mode: ChainMode;
  runtimes: ChainRuntimeItem[];
  enabled: boolean;
  level: SpecialistLevel;
}

/** Providers of every item of every `by_provider` chain, disabled ones included, sorted by id. */
export function knownProviders(config: { chains: readonly RuntimeChain[] }): string[] {
  const providers = new Set<string>();
  for (const chain of config.chains) {
    if (chain.mode !== 'by_provider') continue;
    for (const item of chain.runtimes) if (item.provider) providers.add(item.provider);
  }
  return [...providers].sort();
}

/** The error of a provider the configuration does not know; null when it is known. */
export function providerProblem(
  config: { chains: readonly RuntimeChain[] },
  provider: string,
): string | null {
  const known = knownProviders(config);
  if (known.includes(provider)) return null;
  return `unknown provider \`${provider}\`; known: ${known.join(', ') || 'none'}`;
}

/** Index of the enabled `default: true` item, else of the first enabled item; null when none is enabled. */
export function tierDefaultIndex(chain: Pick<RuntimeChain, 'runtimes'>): number | null {
  const marked = chain.runtimes.findIndex((item) => item.enabled && item.default === true);
  if (marked >= 0) return marked;
  const first = chain.runtimes.findIndex((item) => item.enabled);
  return first >= 0 ? first : null;
}
