import type { EditorChain } from '../../../shared/api/types.ts';
import type { ChainDraft, ChainRuntimeDraft, SpecialistRuntimeName } from './types.ts';

/** Display malformed YAML without invoking user-supplied object conversion methods. */
export function sourceText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `(${Array.isArray(value) ? 'array' : typeof value})`;
}

export function defaultRuntimeItem(): ChainRuntimeDraft {
  return {
    runtime: 'claude',
    model: '',
    model_role: '',
    variant: '',
    reasoning_effort: '',
    enabled: true,
    provider: '',
    default: false,
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

const RUNTIME_NAMES: readonly string[] = [
  'claude',
  'opencode',
  'agy',
  'codex',
  'kilo',
  'cline',
  'copilot',
];

function runtimeItemFrom(raw: unknown): ChainRuntimeDraft {
  if (typeof raw !== 'object' || raw === null) return defaultRuntimeItem();
  const item = raw as Record<string, unknown>;
  const rt: SpecialistRuntimeName =
    typeof item.runtime === 'string' && RUNTIME_NAMES.includes(item.runtime)
      ? (item.runtime as SpecialistRuntimeName)
      : 'claude';
  return {
    runtime: rt,
    ...(item.runtime !== rt ? { invalidRuntime: { value: item.runtime } } : {}),
    model: sourceText(item.model),
    ...(Object.hasOwn(item, 'model_role') && Object.hasOwn(item, 'model')
      ? { conflictingModel: { value: item.model } }
      : {}),
    model_role: typeof item.model_role === 'string' ? item.model_role : '',
    ...(Object.hasOwn(item, 'model_role') &&
    (typeof item.model_role !== 'string' || !item.model_role.trim())
      ? { invalidModelRole: { value: item.model_role } }
      : {}),
    variant: sourceText(item.variant),
    reasoning_effort:
      typeof item.reasoning_effort === 'string'
        ? (item.reasoning_effort as ChainRuntimeDraft['reasoning_effort'])
        : '',
    enabled: item.enabled !== false,
    provider: typeof item.provider === 'string' ? item.provider : '',
    default: item.default === true,
    ...(Object.hasOwn(item, 'variant') || Object.hasOwn(item, 'reasoning_effort')
      ? {
          sourceOptions: Object.fromEntries(
            ['variant', 'reasoning_effort']
              .filter((key) => Object.hasOwn(item, key))
              .map((key) => [key, item[key]]),
          ),
        }
      : {}),
  };
}

export function draftOfChain(entry: EditorChain): ChainDraft {
  const raw = entry.raw ?? {};
  const runtimesRaw = Array.isArray(raw.runtimes) ? raw.runtimes : [];
  const runtimes =
    runtimesRaw.length > 0 ? runtimesRaw.map(runtimeItemFrom) : [defaultRuntimeItem()];
  const mode =
    raw.mode === 'round_robin' || raw.mode === 'random' || raw.mode === 'by_provider'
      ? raw.mode
      : 'on_error';
  return {
    slug: entry.slug,
    name: raw.name !== undefined && raw.name !== null ? String(raw.name) : '',
    mode,
    enabled: raw.enabled !== false,
    runtimes,
  };
}

function valueOfItem(item: ChainRuntimeDraft, tier: boolean): Record<string, unknown> {
  const res: Record<string, unknown> = {
    ...(item.invalidRuntime
      ? item.invalidRuntime.value === undefined
        ? {}
        : { runtime: item.invalidRuntime.value }
      : { runtime: item.runtime }),
    enabled: item.enabled,
  };
  if (item.provider !== '') res.provider = item.provider;
  if (tier && item.default) res.default = true;
  if (item.model.trim()) res.model = item.model;
  if (item.model_role) res.model_role = item.model_role;
  if (item.invalidModelRole) res.model_role = item.invalidModelRole.value;
  if (item.conflictingModel && Object.hasOwn(res, 'model_role'))
    res.model = item.conflictingModel.value;
  if (item.runtime === 'opencode') {
    if (item.variant.trim()) res.variant = item.variant.trim();
    if (item.reasoning_effort) res.reasoning_effort = item.reasoning_effort;
  }
  Object.assign(res, item.sourceOptions);
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
    runtimes: draft.runtimes.map((item) => valueOfItem(item, draft.mode === 'by_provider')),
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
  const left = valueOfItem(a, true);
  const right = valueOfItem(b, true);
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]))
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
