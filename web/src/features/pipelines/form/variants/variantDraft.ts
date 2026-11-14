import { stepIds, type StepIdSource } from '../../stepIds.ts';

/** The fields of an override that name the executor and the model; a chain excludes them. */
export const EXECUTOR_FIELDS = ['runtime', 'model', 'variant', 'reasoningEffort'] as const;

export type ExecutorField = (typeof EXECUTOR_FIELDS)[number];

/**
 * What a variant changes in one step (or in the split). A field that is `undefined` is
 * "as in the pipeline" and is not written; `additionalPrompt` also has `null`: remove it.
 */
export interface OverrideDraft {
  specialist?: string;
  runtime?: string;
  model?: string;
  variant?: string;
  reasoningEffort?: string;
  runtimeChain?: string;
  additionalPrompt?: string | null;
  /** Keys of the file this form does not know; written back, the check reports them. */
  extra?: Record<string, unknown>;
}

export interface VariantDraft {
  /** Stable while the id is edited, so React keeps the focus. */
  key: number;
  id: string;
  /** Empty: the file has no name. */
  name: string;
  /** Skipped steps by `StepDraft.key`. */
  skipKeys: number[];
  /** Ids of `skip` that name no step of the draft; written as they are. */
  skipRaw: string[];
  split: OverrideDraft | null;
  /** Overrides by `StepDraft.key`. */
  steps: Map<number, OverrideDraft>;
  /** Overrides of the file whose id names no step of the draft; written as they are. */
  stepsRaw: Record<string, unknown>;
  /** Keys of the variant this form does not know. */
  extra: Record<string, unknown>;
}

/** What of a step the variants need to know: the id source and the key. */
export interface VariantStep extends StepIdSource {
  key: number;
}

let nextVariantKey = 1;

const OVERRIDE_KEYS: Record<string, keyof OverrideDraft> = {
  specialist: 'specialist',
  runtime: 'runtime',
  model: 'model',
  variant: 'variant',
  reasoning_effort: 'reasoningEffort',
  runtime_chain: 'runtimeChain',
};

const KNOWN_VARIANT_KEYS = ['name', 'skip', 'split', 'steps'];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

function overrideOf(value: unknown): OverrideDraft {
  const raw = asRecord(value);
  const override: OverrideDraft = {};
  const extra: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(raw)) {
    const name = OVERRIDE_KEYS[key];
    if (name) (override as Record<string, unknown>)[name] = asText(field);
    else if (key === 'additional_prompt') {
      override.additionalPrompt = field === null ? null : asText(field);
    } else extra[key] = field;
  }
  if (Object.keys(extra).length > 0) override.extra = extra;
  return override;
}

/** The file content of an override: only the fields that differ from the pipeline. */
export function overrideValue(override: OverrideDraft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [file, name] of Object.entries(OVERRIDE_KEYS)) {
    const field = override[name] as string | undefined;
    if (field !== undefined) value[file] = field;
  }
  if (override.additionalPrompt !== undefined) value.additional_prompt = override.additionalPrompt;
  return { ...value, ...override.extra };
}

/** Whether the override changes nothing. */
export function isEmptyOverride(override: OverrideDraft | undefined): boolean {
  return override === undefined || Object.keys(overrideValue(override)).length === 0;
}

/** The override with `patch` applied; a chain and the executor fields clear each other. */
export function patchOverride(
  override: OverrideDraft,
  patch: Partial<OverrideDraft>,
): OverrideDraft {
  const next: OverrideDraft = { ...override, ...patch };
  if (patch.runtimeChain !== undefined) {
    for (const field of EXECUTOR_FIELDS) delete next[field];
  } else if (EXECUTOR_FIELDS.some((field) => patch[field] !== undefined)) {
    delete next.runtimeChain;
  }
  // The options of OpenCode mean nothing for another executor.
  if (patch.runtime !== undefined && patch.runtime !== 'opencode') {
    delete next.variant;
    delete next.reasoningEffort;
  }
  for (const key of Object.keys(next) as (keyof OverrideDraft)[]) {
    if (key in patch && patch[key] === undefined) delete next[key];
  }
  return next;
}

/**
 * The variants of a file as drafts. Step ids of the file are turned into the keys of the steps
 * (like `gotoRaw` into `gotoKey`); an id without a step stays as it is.
 */
export function variantsOf(rawVariants: unknown, steps: readonly VariantStep[]): VariantDraft[] {
  const ids = stepIds(steps);
  const keyOf = (id: string): number | null => {
    const index = ids.indexOf(id);
    return index >= 0 && id !== '' ? (steps[index]?.key ?? null) : null;
  };
  return Object.entries(asRecord(rawVariants)).map(([id, value]) => {
    const raw = asRecord(value);
    const variant: VariantDraft = {
      key: nextVariantKey++,
      id,
      name: asText(raw.name),
      skipKeys: [],
      skipRaw: [],
      split: raw.split === undefined ? null : overrideOf(raw.split),
      steps: new Map(),
      stepsRaw: {},
      extra: {},
    };
    for (const item of Array.isArray(raw.skip) ? raw.skip : []) {
      const key = typeof item === 'string' ? keyOf(item) : null;
      if (key === null) variant.skipRaw.push(asText(item));
      else if (!variant.skipKeys.includes(key)) variant.skipKeys.push(key);
    }
    for (const [stepId, override] of Object.entries(asRecord(raw.steps))) {
      const key = keyOf(stepId);
      if (key === null) variant.stepsRaw[stepId] = override;
      else variant.steps.set(key, overrideOf(override));
    }
    for (const [key, field] of Object.entries(raw)) {
      if (!KNOWN_VARIANT_KEYS.includes(key)) variant.extra[key] = field;
    }
    return variant;
  });
}

/**
 * The `variants` of the file for a draft. Keys of steps become the current ids. With
 * `delegated` (the groups follow another pipeline) `steps` and `skip` are left out, as the
 * pipeline's own `steps` are; the draft keeps them for the way back.
 */
export function variantsValue(
  variants: readonly VariantDraft[],
  steps: readonly VariantStep[],
  delegated: boolean,
): Record<string, unknown> | undefined {
  if (variants.length === 0) return undefined;
  const ids = stepIds(steps);
  const result: Record<string, unknown> = {};
  for (const variant of variants) {
    const value: Record<string, unknown> = {};
    if (variant.name.trim() !== '') value.name = variant.name.trim();
    if (!delegated) {
      const skip = [
        ...steps.flatMap((step, index) =>
          variant.skipKeys.includes(step.key) && ids[index] ? [ids[index]] : [],
        ),
        ...variant.skipRaw,
      ];
      if (skip.length > 0) value.skip = skip;
    }
    if (variant.split && !isEmptyOverride(variant.split)) {
      value.split = overrideValue(variant.split);
    }
    if (!delegated) {
      const overrides: Record<string, unknown> = {};
      for (const [index, step] of steps.entries()) {
        const override = variant.steps.get(step.key);
        if (override && !isEmptyOverride(override) && ids[index]) {
          overrides[ids[index]] = overrideValue(override);
        }
      }
      Object.assign(overrides, variant.stepsRaw);
      if (Object.keys(overrides).length > 0) value.steps = overrides;
    }
    result[variant.id] = { ...value, ...variant.extra };
  }
  return result;
}

/** Whether another variant of the draft has the id of this one (they would overwrite each other). */
export function hasDuplicateId(variants: readonly VariantDraft[], variant: VariantDraft): boolean {
  return variants.some((item) => item.key !== variant.key && item.id === variant.id);
}

/** Whether two variants of the draft share an id: the file cannot hold both. */
export function hasDuplicateIds(variants: readonly VariantDraft[]): boolean {
  return new Set(variants.map((variant) => variant.id)).size < variants.length;
}

/** A free id for a new variant: `variant`, `variant-2`, … */
export function freeVariantId(variants: readonly VariantDraft[]): string {
  const taken = new Set(variants.map((variant) => variant.id));
  let id = 'variant';
  for (let n = 2; taken.has(id); n++) id = `variant-${n}`;
  return id;
}

/** A variant that changes nothing, with a free id. */
export function newVariant(variants: readonly VariantDraft[]): VariantDraft {
  return {
    key: nextVariantKey++,
    id: freeVariantId(variants),
    name: '',
    skipKeys: [],
    skipRaw: [],
    split: null,
    steps: new Map(),
    stepsRaw: {},
    extra: {},
  };
}

/** The variants without the step: its override and its skip go away. */
export function withoutStep(variants: readonly VariantDraft[], key: number): VariantDraft[] {
  return variants.map((variant) => {
    if (!variant.steps.has(key) && !variant.skipKeys.includes(key)) return variant;
    const steps = new Map(variant.steps);
    steps.delete(key);
    return { ...variant, steps, skipKeys: variant.skipKeys.filter((item) => item !== key) };
  });
}

/**
 * The steps and the split as the variant shows them: the specialists of its overrides, and the
 * keys of the steps it skips. The draft itself is not changed.
 */
export function appliedView<T extends VariantStep, S extends { specialist: string }>(
  steps: readonly T[],
  split: S | null,
  variant: VariantDraft,
): { steps: T[]; split: S | null; skipped: Set<number> } {
  // Ids are fixed from the pipeline's own steps: a replaced specialist must not rename a step.
  const ids = stepIds(steps);
  return {
    steps: steps.map((step, index) => {
      const specialist = variant.steps.get(step.key)?.specialist;
      return {
        ...step,
        specialist: specialist || step.specialist,
        autoId: false,
        fixedId: ids[index] ?? '',
      };
    }),
    split:
      split && variant.split?.specialist
        ? { ...split, specialist: variant.split.specialist }
        : split,
    skipped: new Set(variant.skipKeys),
  };
}
