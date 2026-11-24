import type { ReasoningEffort, RuntimeChain } from '../../../swarm-config/types/index.ts';
import type { Attempt } from '../attempt.ts';
import type { AttemptRuntime } from '../constants.ts';

export interface SelectedRuntime {
  runtime: AttemptRuntime;
  model: string | null;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  chainIndex?: number | null;
  provider?: string;
}

type ChainEntry = { item: RuntimeChain['runtimes'][number]; index: number };

/** The key of a usage-limit hold: the provider of the attempt when it has one, else its runtime. */
export function holdKey(runtime: string, provider?: string | null): string {
  return provider ? `provider:${provider}` : runtime;
}

/** The hold that covers a runtime with a provider: its provider key or its runtime key, the later one. */
export function holdOf(
  holds: Map<string, number>,
  runtime: string,
  provider?: string | null,
): { until: number; provider?: string } | undefined {
  const byRuntime = holds.get(runtime);
  const byProvider = provider ? holds.get(holdKey(runtime, provider)) : undefined;
  if (byProvider !== undefined && (byRuntime === undefined || byProvider >= byRuntime)) {
    return { until: byProvider, provider: provider! };
  }
  return byRuntime === undefined ? undefined : { until: byRuntime };
}

/** When a runtime with a provider is held until; undefined when no hold covers it. */
export function heldUntil(
  holds: Map<string, number>,
  runtime: string,
  provider?: string | null,
): number | undefined {
  return holdOf(holds, runtime, provider)?.until;
}

/** Chains that pick the next item after a failure: `by_provider` without a provider works like `on_error`. */
function failsOver(mode: RuntimeChain['mode']): boolean {
  return mode === 'on_error' || mode === 'by_provider';
}

export function currentStepFailedIndices(attempts: Attempt[], stepIndex: number): Set<number> {
  const failed = new Set<number>();
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]!;
    if (a.stepIndex !== stepIndex || a.status !== 'failed') break;
    // The network, not the runtime, failed: the item stays a candidate.
    if (a.reason?.kind === 'network') continue;
    if (a.chainIndex !== undefined && a.chainIndex !== null) {
      failed.add(a.chainIndex);
    }
  }
  return failed;
}

export function pickChainItem(
  mode: RuntimeChain['mode'],
  enabledItems: ChainEntry[],
  limitHolds: Map<string, number>,
  attempts: Attempt[],
  specialistSlug: string,
  stepIndex: number,
  seed?: number,
): SelectedRuntime {
  const free = ({ item }: ChainEntry): boolean =>
    heldUntil(limitHolds, item.runtime, item.provider) === undefined;
  if (failsOver(mode)) {
    const failedIndices = currentStepFailedIndices(attempts, stepIndex);
    const candidate = enabledItems.find((entry) => !failedIndices.has(entry.index) && free(entry));
    const choice =
      candidate ?? enabledItems.find(({ index }) => !failedIndices.has(index)) ?? enabledItems[0]!;
    return formatSelected(choice);
  }
  const available = enabledItems.filter(free);
  const pool = available.length > 0 ? available : enabledItems;
  if (mode === 'round_robin') {
    // The phase counts the attempts of the items that are candidates now, so a filtered pool keeps
    // its own cycle.
    const indices = new Set(pool.map((entry) => entry.index));
    const count = attempts.filter(
      (a) =>
        a.specialist === specialistSlug &&
        a.chainIndex !== null &&
        a.chainIndex !== undefined &&
        indices.has(a.chainIndex),
    ).length;
    const choice = pool[count % pool.length]!;
    return formatSelected(choice);
  }
  const pick = seed !== undefined ? Math.abs(seed) % pool.length : 0;
  const choice = pool[pick]!;
  return formatSelected(choice);
}

export function formatSelected(entry: ChainEntry): SelectedRuntime {
  return {
    runtime: entry.item.runtime,
    model: entry.item.model ?? null,
    ...(entry.item.variant !== undefined ? { variant: entry.item.variant } : {}),
    ...(entry.item.reasoningEffort !== undefined
      ? { reasoningEffort: entry.item.reasoningEffort }
      : {}),
    ...(entry.item.provider !== undefined ? { provider: entry.item.provider } : {}),
    chainIndex: entry.index,
  };
}

export function hasNextChainItem(
  chain: RuntimeChain | undefined,
  attempts: Attempt[],
  stepIndex: number,
  limitHolds: Map<string, number>,
  provider: string | null = null,
): boolean {
  if (!chain || !chain.enabled || !failsOver(chain.mode)) return false;
  const failedIndices = currentStepFailedIndices(attempts, stepIndex);
  return chain.runtimes.some(
    (item, index) =>
      item.enabled &&
      (provider === null || item.provider === provider) &&
      !failedIndices.has(index) &&
      heldUntil(limitHolds, item.runtime, item.provider) === undefined,
  );
}
