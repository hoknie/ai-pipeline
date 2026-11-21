import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { useProvidersScope } from '../page/scope.ts';
import {
  overrideValue,
  sourceOf,
  writableSourceOf,
  type ProviderSource,
  type ProvidersScope,
} from '../page/sources.ts';
import { invalidateProviders } from '../page/useProviderRegistry.ts';
import {
  draftOf,
  emptyDraft,
  formErrors,
  type FormErrors,
  type FormStep,
  type ProviderDraft,
} from './draft.ts';
import {
  NO_PROBLEMS,
  removeProvider,
  submitOverride,
  submitProvider,
  type FormProblems,
} from './submit.ts';

export type { FormProblems };

/** Writes `default_provider` at a level; resolves to the error text, or null once accepted. */
type AssignDefault = (slug: string, level: 'global' | 'project') => Promise<string | null>;

/** Words the address of the form uses: a provider with such a slug could not be opened. */
const RESERVED = ['new', 'roles'];

/** The draft of the form: of the file for an existing provider (once the editor view is here), else new. */
function useDraft(
  slug: string | null,
  initial: ProviderDraft | null,
  source: ProviderSource | null,
  scope: ProvidersScope,
) {
  // a new provider is written at the level of the scope, never at the other one
  const [draft, setDraft] = useState<ProviderDraft | null>(
    slug === null ? { ...(initial ?? emptyDraft()), level: scope } : null,
  );
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    // read again when the file that applies changes level: a shared provider just overridden
    const key = source === null ? null : `${slug}:${source.level}`;
    if (slug === null || source === null || loaded === key) return;
    setDraft(draftOf(slug, source.raw, source.level));
    setLoaded(key);
  }, [slug, source, loaded]);
  return [draft, setDraft] as const;
}

interface SubmitOptions {
  api: Api;
  repository: string | null;
  slug: string | null;
  /** The file a write may change; null for a provider the scope may only look at. */
  source: ProviderSource | null;
  /** The shared file shown read only, to copy into the project. */
  shown: ProviderSource | null;
  locked: boolean;
  draft: ProviderDraft | null;
  onSaved: (slug: string) => void;
  onDeleted: () => void;
  onStep: (step: FormStep) => void;
  assignDefault?: AssignDefault | undefined;
}

/** Save and delete with the answers of the daemon: problems by field, the places that use it. */
function useSubmit(options: SubmitOptions) {
  const { api, repository, slug, source, shown, locked, draft } = options;
  const { t } = useTranslation();
  const [problems, setProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [busy, setBusy] = useState(false);
  // a new provider whose file is written: a second try only writes `default_provider`
  const created = useRef<string | null>(null);
  const save = async () => {
    if (!draft || locked) return;
    setBusy(true);
    const outcome =
      created.current === null
        ? await submitProvider(api, draft, slug, source)
        : { saved: created.current };
    if ('saved' in outcome) {
      created.current = slug === null ? outcome.saved : null;
      await invalidateProviders(repository);
      if (slug === null && draft.makeDefault && options.assignDefault) {
        const failure = await options.assignDefault(outcome.saved, draft.level);
        if (failure !== null) {
          setProblems({
            ...NO_PROBLEMS,
            general: [t('providers.default.notAssigned', { message: failure })],
          });
          setBusy(false);
          return;
        }
      }
      options.onSaved(outcome.saved);
    } else {
      setProblems(outcome.problems);
      if (outcome.step) options.onStep(outcome.step);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (slug === null || source === null || locked) return;
    setBusy(true);
    const failure = await removeProvider(api, slug, source);
    if (failure === null) {
      await invalidateProviders(repository);
      options.onDeleted();
    } else setProblems(failure);
    setBusy(false);
  };
  /** Writes the project copy of a shared provider; the shared file stays as it is. */
  const override = async () => {
    if (slug === null || shown === null || !locked) return;
    setBusy(true);
    const failure = await submitOverride(api, slug, overrideValue(shown.raw).raw);
    await invalidateProviders(repository);
    setProblems(failure ?? NO_PROBLEMS);
    setBusy(false);
  };
  return { problems, clear: () => setProblems(NO_PROBLEMS), busy, save, remove, override };
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
  /** Writes `default_provider` for a new provider made the default; resolves to an error text. */
  assignDefault?: AssignDefault | undefined;
}) {
  const { slug, registry, editor } = options;
  const scope = useProvidersScope();
  const isNew = slug === null;
  const found = slug === null ? undefined : editor?.providers.find((item) => item.slug === slug);
  const shown = useMemo(() => sourceOf(found, scope), [found, scope]);
  const source = useMemo(() => writableSourceOf(found, scope), [found, scope]);
  // the project scope may only look at a provider that exists at the shared level alone
  const locked = shown !== null && source === null;
  const [draft, setDraft] = useDraft(slug, options.initial, shown, scope);
  const [step, setStep] = useState<FormStep>('name');
  const submit = useSubmit({ ...options, source, shown, locked, draft, onStep: setStep });
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
    override: submit.override,
    locked,
    /** The shared file has `command`/`args` that the project copy leaves out. */
    strips: locked && shown !== null && overrideValue(shown.raw).stripped,
  };
}
