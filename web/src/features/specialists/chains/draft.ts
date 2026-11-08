import type { EditorChain } from '../../../shared/api/types.ts';
import type { ChainDraft, ChainRuntimeDraft, SpecialistRuntimeName } from './types.ts';

export function defaultRuntimeItem(): ChainRuntimeDraft {
  return {
    runtime: 'claude',
    model: '',
    variant: '',
    reasoning_effort: '',
    enabled: true,
  };
}

export function defaultChainDraft(slug = ''): ChainDraft {
  return {
    slug,
    name: '',
    mode: 'on_error',
    enabled: true,
    runtimes: [defaultRuntimeItem()],
  };
}

function runtimeItemFrom(raw: unknown): ChainRuntimeDraft {
  if (typeof raw !== 'object' || raw === null) return defaultRuntimeItem();
  const item = raw as Record<string, unknown>;
  const rt: SpecialistRuntimeName =
    item.runtime === 'opencode' || item.runtime === 'agy' ? item.runtime : 'claude';
  return {
    runtime: rt,
    model: item.model !== undefined && item.model !== null ? String(item.model) : '',
    variant: item.variant !== undefined && item.variant !== null ? String(item.variant) : '',
    reasoning_effort:
      item.reasoning_effort !== undefined && item.reasoning_effort !== null
        ? (String(item.reasoning_effort) as ChainRuntimeDraft['reasoning_effort'])
        : '',
    enabled: item.enabled !== false,
  };
}

export function draftOfChain(entry: EditorChain): ChainDraft {
  const raw = entry.raw ?? {};
  const runtimesRaw = Array.isArray(raw.runtimes) ? raw.runtimes : [];
  const runtimes =
    runtimesRaw.length > 0 ? runtimesRaw.map(runtimeItemFrom) : [defaultRuntimeItem()];
  const mode = raw.mode === 'round_robin' || raw.mode === 'random' ? raw.mode : 'on_error';
  return {
    slug: entry.slug,
    name: raw.name !== undefined && raw.name !== null ? String(raw.name) : '',
    mode,
    enabled: raw.enabled !== false,
    runtimes,
  };
}

function valueOfItem(item: ChainRuntimeDraft): Record<string, unknown> {
  const res: Record<string, unknown> = {
    runtime: item.runtime,
    enabled: item.enabled,
  };
  if (item.model.trim()) res.model = item.model.trim();
  if (item.runtime === 'opencode') {
    if (item.variant.trim()) res.variant = item.variant.trim();
    if (item.reasoning_effort) res.reasoning_effort = item.reasoning_effort;
  }
  return res;
}

export function valueOfChain(
  draft: ChainDraft,
  raw?: Record<string, unknown>,
): Record<string, unknown> {
  const value: Record<string, unknown> = {
    name: draft.name.trim() || draft.slug,
    mode: draft.mode,
    enabled: draft.enabled,
    runtimes: draft.runtimes.map(valueOfItem),
  };
  if (raw) {
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in value)) value[k] = v;
    }
  }
  return value;
}

function sameItem(a: ChainRuntimeDraft, b: ChainRuntimeDraft | undefined): boolean {
  if (!b) return false;
  return (
    a.runtime === b.runtime &&
    a.model === b.model &&
    a.variant === b.variant &&
    a.reasoning_effort === b.reasoning_effort &&
    a.enabled === b.enabled
  );
}

export function sameChainDraft(a: ChainDraft, b: ChainDraft): boolean {
  if (
    a.slug !== b.slug ||
    a.name !== b.name ||
    a.mode !== b.mode ||
    a.enabled !== b.enabled ||
    a.runtimes.length !== b.runtimes.length
  ) {
    return false;
  }
  return a.runtimes.every((item, i) => sameItem(item, b.runtimes[i]));
}
