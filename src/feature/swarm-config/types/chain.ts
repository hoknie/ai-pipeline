import type { ReasoningEffort, Runtime, SpecialistLevel } from './specialist.ts';

export const CHAIN_MODES = ['on_error', 'random', 'round_robin', 'by_provider'] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];

/** Executable snapshot item: source `model_role` references are resolved at configuration load. */
export interface ChainRuntimeItem {
  runtime: Runtime;
  model: string | null;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  enabled: boolean;
  /** Slug of a provider of the configuration; the key of the limit hold, and the map key of a `by_provider` chain. */
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

/** Index of the enabled `default: true` item, else of the first enabled item; null when none is enabled. */
export function tierDefaultIndex(chain: Pick<RuntimeChain, 'runtimes'>): number | null {
  const marked = chain.runtimes.findIndex((item) => item.enabled && item.default === true);
  if (marked >= 0) return marked;
  const first = chain.runtimes.findIndex((item) => item.enabled);
  return first >= 0 ? first : null;
}
