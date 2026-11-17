import type { Api } from '../../../shared/api/api.ts';
import type { EntryReference } from '../../../shared/api/types.ts';
import { editFailure } from '../matrix/useCellWrite.ts';
import type { ProviderSource } from '../page/sources.ts';
import { fieldOfPath, stepOfPath, valueOf, type FormStep, type ProviderDraft } from './draft.ts';

export interface FormProblems {
  /** Errors of the daemon by field. */
  fields: Record<string, string>;
  /** Errors without a field, shown above the form. */
  general: string[];
  /** The places that still use the provider, when a delete was refused. */
  references: EntryReference[];
}

export const NO_PROBLEMS: FormProblems = { fields: {}, general: [], references: [] };

const general = (...messages: string[]): FormProblems => ({ ...NO_PROBLEMS, general: messages });

/** The errors of a file by field (the form's addresses) and the ones outside any field. */
function problemsOf(errors: { path: string; message: string }[]): FormProblems {
  const fields: Record<string, string> = {};
  const rest: string[] = [];
  for (const error of errors) {
    const field = fieldOfPath(error.path);
    if (field === '') rest.push(`${error.path}: ${error.message}`);
    else fields[field] ??= error.message;
  }
  return { fields, general: rest, references: [] };
}

export type SaveOutcome = { saved: string } | { problems: FormProblems; step: FormStep | null };

/** Writes the provider; a refusal comes back as problems and the step of the first field to show. */
export async function submitProvider(
  api: Api,
  draft: ProviderDraft,
  slug: string | null,
  source: ProviderSource | null,
): Promise<SaveOutcome> {
  const target = slug ?? draft.slug;
  try {
    const result = await api.writeProvider(
      target,
      valueOf(draft),
      slug === null ? null : (source?.revision ?? null),
      draft.level,
    );
    if (result.ok) return { saved: target };
    if (result.reason === 'conflict') return { problems: general(editFailure(result)), step: null };
    const first = result.errors.find((error) => fieldOfPath(error.path) !== '');
    return { problems: problemsOf(result.errors), step: first ? stepOfPath(first.path) : null };
  } catch (error) {
    return { problems: general((error as Error).message), step: null };
  }
}

/** Deletes the provider; `null` when it is gone, else why not (the places that use it). */
export async function removeProvider(
  api: Api,
  slug: string,
  source: ProviderSource,
): Promise<FormProblems | null> {
  try {
    const result = await api.deleteProvider(slug, source.revision, source.level);
    if (result.ok) return null;
    if (result.reason === 'conflict') return general(editFailure(result));
    const references = result.references ?? [];
    return {
      ...NO_PROBLEMS,
      general: references.length > 0 ? [] : result.errors.map((error) => error.message),
      references,
    };
  } catch (error) {
    return general((error as Error).message);
  }
}
