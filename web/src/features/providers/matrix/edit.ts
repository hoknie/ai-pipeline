import type { Raw } from '../page/sources.ts';

const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The options of a model of a role in a provider file. */
export interface ModelOptions {
  variant?: string;
  effort?: string;
}

function modelsOf(raw: Raw): Raw {
  return isRaw(raw.models) ? raw.models : {};
}

/** The model of a role as the file has it: the id and its options; null without one. */
export function roleModelOf(
  raw: Raw,
  role: string,
): { model: string; variant: string; effort: string } | null {
  const value = modelsOf(raw)[role];
  if (typeof value === 'string') return { model: value, variant: '', effort: '' };
  if (!isRaw(value) || typeof value.model !== 'string') return null;
  return {
    model: value.model,
    variant: typeof value.variant === 'string' ? value.variant : '',
    effort: typeof value.reasoning_effort === 'string' ? value.reasoning_effort : '',
  };
}

/**
 * The provider with `models.<role>` set: a string, or an object when there are options. Only the
 * models of the provider change, never the ones of its accesses.
 */
export function setRoleModel(
  raw: Raw,
  role: string,
  model: string,
  options: ModelOptions = {},
): Raw {
  const extra = (options.variant ?? '') !== '' || (options.effort ?? '') !== '';
  const value = extra
    ? {
        model,
        ...(options.variant ? { variant: options.variant } : {}),
        ...(options.effort ? { reasoning_effort: options.effort } : {}),
      }
    : model;
  return { ...raw, models: { ...modelsOf(raw), [role]: value } };
}

/** The provider without `models.<role>`; `models` goes away when it is empty. */
export function clearRole(raw: Raw, role: string): Raw {
  const { [role]: _removed, ...rest } = modelsOf(raw);
  const { models: _models, ...others } = raw;
  return Object.keys(rest).length === 0 ? others : { ...others, models: rest };
}
