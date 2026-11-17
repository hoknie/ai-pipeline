import { useEffect, useMemo, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { useProvidersScope } from '../page/scope.ts';
import { sourceOf, type ProviderSource } from '../page/sources.ts';
import { invalidateProviders } from '../page/useProviderRegistry.ts';
import {
  draftOf,
  emptyDraft,
  formErrors,
  type FormErrors,
  type FormStep,
  type ProviderDraft,
} from './draft.ts';
import { NO_PROBLEMS, removeProvider, submitProvider, type FormProblems } from './submit.ts';

export type { FormProblems };

/** Words the address of the form uses: a provider with such a slug could not be opened. */
const RESERVED = ['new', 'roles'];

/** The draft of the form: of the file for an existing provider (once the editor view is here), else new. */
function useDraft(
  slug: string | null,
  initial: ProviderDraft | null,
  source: ProviderSource | null,
) {
  const [draft, setDraft] = useState<ProviderDraft | null>(
    slug === null ? (initial ?? emptyDraft()) : null,
  );
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (slug === null || source === null || loaded === slug) return;
    setDraft(draftOf(slug, source.raw, source.level));
    setLoaded(slug);
  }, [slug, source, loaded]);
  return [draft, setDraft] as const;
}

interface SubmitOptions {
  api: Api;
  repository: string | null;
  slug: string | null;
  source: ProviderSource | null;
  draft: ProviderDraft | null;
  onSaved: (slug: string) => void;
  onDeleted: () => void;
  onStep: (step: FormStep) => void;
}

/** Save and delete with the answers of the daemon: problems by field, the places that use it. */
function useSubmit(options: SubmitOptions) {
  const { api, repository, slug, source, draft } = options;
  const [problems, setProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const outcome = await submitProvider(api, draft, slug, source);
    if ('saved' in outcome) {
      await invalidateProviders(repository);
      options.onSaved(outcome.saved);
    } else {
      setProblems(outcome.problems);
      if (outcome.step) options.onStep(outcome.step);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (slug === null || source === null) return;
    setBusy(true);
    const failure = await removeProvider(api, slug, source);
    if (failure === null) {
      await invalidateProviders(repository);
      options.onDeleted();
    } else setProblems(failure);
    setBusy(false);
  };
  return { problems, clear: () => setProblems(NO_PROBLEMS), busy, save, remove };
}

/**
 * The state of the form of a provider: the draft (of the file, or the start of a new one), the step,
 * the checks of the form and the answers of the daemon to a save and a delete.
 */
export function useProviderForm(options: {
  api: Api;
  repository: string | null;
  /** The slug of the provider to edit; null creates a new one. */
  slug: string | null;
  initial: ProviderDraft | null;
  registry: ProvidersView | null;
  editor: ConfigEditorResponse | null;
  onSaved: (slug: string) => void;
  onDeleted: () => void;
}) {
  const { slug, registry, editor } = options;
  const scope = useProvidersScope();
  const isNew = slug === null;
  const source = useMemo(
    () =>
      slug === null
        ? null
        : sourceOf(
            editor?.providers.find((item) => item.slug === slug),
            scope,
          ),
    [slug, editor, scope],
  );
  const [draft, setDraft] = useDraft(
    slug,
    options.initial && scope === 'global'
      ? { ...options.initial, level: 'global' }
      : options.initial,
    source,
  );
  const [step, setStep] = useState<FormStep>('name');
  const submit = useSubmit({ ...options, source, draft, onStep: setStep });
  const taken = useMemo(
    () => new Set([...(registry?.providers.map((item) => item.slug) ?? []), ...RESERVED]),
    [registry],
  );
  const errorsOf = (which: FormStep): FormErrors =>
    draft ? formErrors(draft, which, taken, isNew) : {};
  return {
    draft,
    isNew,
    step,
    setStep,
    setDraft: (patch: Partial<ProviderDraft>) => {
      setDraft((current) => (current ? { ...current, ...patch } : current));
      submit.clear();
    },
    replaceDraft: (next: ProviderDraft) => {
      setDraft(next);
      submit.clear();
    },
    problems: submit.problems,
    busy: submit.busy,
    errorsOf,
    stepValid: (which: FormStep) => Object.keys(errorsOf(which)).length === 0,
    save: submit.save,
    remove: submit.remove,
  };
}
