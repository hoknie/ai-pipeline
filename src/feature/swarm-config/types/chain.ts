import type { ReasoningEffort, Runtime, SpecialistLevel } from './specialist.ts';

export const CHAIN_MODES = ['on_error', 'random', 'round_robin'] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];

export interface ChainRuntimeItem {
  runtime: Runtime;
  model: string | null;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  enabled: boolean;
}

export interface RuntimeChain {
  slug: string;
  name: string;
  mode: ChainMode;
  runtimes: ChainRuntimeItem[];
  enabled: boolean;
  level: SpecialistLevel;
}
