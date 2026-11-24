import {
  type ReasoningEffort,
  type ResolvedConfig,
  type Runtime,
  type RuntimeChain,
  type Specialist,
  type StepAgent,
} from '../../../swarm-config/types/index.ts';

/** Where the executor of a step comes from: the chain picks it at the launch, or it is fixed. */
export type RuntimeSource = 'chain' | 'variant' | 'specialist' | 'defaults' | 'unknown';

/** Where the model comes from; `runtime` — the model of the runtime itself (`model: null`). */
export type ModelSource = 'chain' | 'variant' | 'specialist' | 'runtime';

/** An item of the chain the launch picks from: an executor and a model; disabled ones included. */
export interface LaunchCandidate {
  runtime: Runtime;
  model: string | null;
  /** Provider of the item: the key of a limit hold and the map key of a `by_provider` chain. */
  provider?: string;
  /** OpenCode model options. */
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  /** Only in a `by_provider` chain: the item the launch takes when no provider is requested. */
  default?: boolean;
  /** Whether the launch may pick the item. */
  enabled: boolean;
}

/** What the launch picks for a step: an item of this chain, by its mode and the provider of the run. */
export interface LaunchPlan {
  /** Slug of the chain. */
  chain: string;
  /** Display name of the chain. */
  name: string;
  mode: RuntimeChain['mode'];
  /** Whether the launch picks from the candidates; false when the chain or every item is off: the defaults apply. */
  active: boolean;
  /** The items of the chain in the order of the file. */
  candidates: LaunchCandidate[];
}

/** The launch plan of a step: the fixed executor with its sources, or the chain that picks one. */
export interface RuntimePlan {
  /** Slug of the chain that picks the executor at the launch; null when both are fixed. */
  runtimeChain: string | null;
  /** Where `runtime` comes from. */
  runtimeSource: RuntimeSource;
  /** Where `model` comes from; `runtime` — the model of the runtime itself. */
  modelSource: ModelSource;
  /** What the launch picks from the chain; null when the executor and the model are fixed. */
  launch: LaunchPlan | null;
}

/** The chain of a specialist as the launch plan: its mode and its items in the order of the file. */
export function launchPlan(
  config: ResolvedConfig,
  specialist: Specialist | undefined,
): LaunchPlan | null {
  const slug = specialist?.runtimeChain;
  if (!slug) return null;
  const chain = config.chains.find((item) => item.slug === slug);
  if (!chain) return null;
  return {
    chain: chain.slug,
    name: chain.name,
    mode: chain.mode,
    active: chain.enabled && chain.runtimes.some((item) => item.enabled),
    candidates: chain.runtimes.map((item) => ({
      runtime: item.runtime,
      model: item.model ?? null,
      ...(item.provider !== undefined ? { provider: item.provider } : {}),
      ...(item.variant !== undefined ? { variant: item.variant } : {}),
      ...(item.reasoningEffort !== undefined ? { reasoningEffort: item.reasoningEffort } : {}),
      ...(item.default ? { default: true } : {}),
      enabled: item.enabled,
    })),
  };
}

/**
 * The launch plan of a step: an active chain picks the executor and the model at the launch; an
 * override of a variant wins over the specialist. The resolved configuration does not retain
 * whether the specialist explicitly chose the same runtime as the defaults.
 */
export function launchOf(
  config: ResolvedConfig,
  step: { agent?: StepAgent },
  specialist: Specialist | undefined,
): RuntimePlan {
  const launch = launchPlan(config, specialist);
  const override = step.agent;
  return {
    runtimeChain: specialist?.runtimeChain ?? null,
    runtimeSource: launch?.active
      ? 'chain'
      : specialist?.runtimeChain
        ? 'defaults'
        : override?.runtime !== undefined
          ? 'variant'
          : specialist && specialist.runtime !== config.defaults.runtime
            ? 'specialist'
            : specialist
              ? 'unknown'
              : 'defaults',
    modelSource: launch?.active
      ? 'chain'
      : specialist?.runtimeChain
        ? 'runtime'
        : override?.model !== undefined
          ? 'variant'
          : specialist?.model
            ? 'specialist'
            : 'runtime',
    launch,
  };
}
