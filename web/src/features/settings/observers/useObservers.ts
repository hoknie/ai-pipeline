import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { ObserverSettings, ObserversView } from '../../../shared/api/observerTypes.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorChain,
  FieldError,
} from '../../../shared/api/types.ts';
import { formOf, keyOf, settingsOf, type Form } from './form.ts';

/** The settings of the observers as the server has them, the form over them and the saving. */
/** The config and the catalog the specialist fields need, and the defaults read from the config. */
function useObserverSources(api: Api) {
  const [config, setConfig] = useState<ConfigEditorResponse | null>(null);
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  useEffect(() => {
    let closed = false;
    api
      .config()
      .then((next) => {
        if (!closed) setConfig(next);
      })
      .catch(() => undefined);
    api
      .catalog()
      .then((next) => {
        if (!closed) setCatalog(next);
      })
      .catch((error: Error) => {
        if (!closed) setCatalogError(error.message);
      });
    return () => {
      closed = true;
    };
  }, [api]);
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        (config?.settings ?? [])
          .filter((setting) => setting.path.startsWith('defaults.'))
          .map((setting) => [setting.path, setting.globalValue]),
      ),
    [config],
  );
  /** The observer's specialist is global: only the chains of the global level can be chosen. */
  const chains = useMemo(
    () =>
      (config?.chains ?? []).flatMap((chain): EditorChain[] => {
        const source = chain.sources.global;
        return source ? [{ ...chain, ...source, level: 'global' }] : [];
      }),
    [config],
  );
  return { defaults, catalog, catalogError, chains };
}

/** Saving the form: the server's errors stay with the form, a failure of the request goes up. */
function useObserverSave(
  api: Api,
  adopt: (view: ObserversView) => void,
  submitted: ObserverSettings | null,
) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  /** The repositories of the projects as sent: the numbers of the server's errors count them. */
  const [sent, setSent] = useState<string[]>([]);
  const save = async () => {
    if (!submitted) return;
    setBusy(true);
    setProblem(null);
    setErrors([]);
    setSent(submitted.projects.map((project) => project.repository));
    try {
      const result = await api.setObservers(submitted);
      if (result.ok) {
        adopt(result.view);
        notifySuccess(t('observers.saved'));
      } else {
        setErrors(result.errors);
      }
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { problem, errors, setErrors, sent, busy, save };
}

export function useObservers(
  api: Api,
  streamed: ObserversView | null,
  repositories: string[],
  onDirty: (dirty: boolean) => void,
) {
  const { t } = useTranslation();
  const [view, setView] = useState<ObserversView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [failure, setFailure] = useState<string | null>(null);
  const rawSpecialist = useRef<Record<string, unknown>>({});

  const adopt = (next: ObserversView) => {
    rawSpecialist.current = next.settings.specialist;
    const fresh = formOf(next.settings);
    setView(next);
    setForm(fresh);
    setSaved(keyOf(fresh));
  };

  useEffect(() => {
    let closed = false;
    api
      .observers()
      .then((next) => {
        if (!closed) adopt(next);
      })
      .catch((error: Error) => {
        if (!closed) setFailure(error.message);
      });
    return () => {
      closed = true;
    };
  }, [api]);

  const dirty = form !== null && keyOf(form) !== saved;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  // Settings changed in another tab of the browser: the form follows unless it has edits.
  useEffect(() => {
    if (streamed === null) return;
    if (dirty) {
      setView((current) => (current ? { ...current, workers: streamed.workers } : current));
      return;
    }
    adopt(streamed);
    // only a new event matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamed]);

  const { defaults, catalog, catalogError, chains } = useObserverSources(api);

  const order = useMemo(() => [...new Set(repositories)], [repositories]);
  const submitted = form ? settingsOf(form, order, rawSpecialist.current) : null;

  const { problem, errors, setErrors, sent, busy, save } = useObserverSave(api, adopt, submitted);
  const discard = () => {
    setErrors([]);
    if (view) setForm(formOf({ ...view.settings, specialist: rawSpecialist.current }));
  };
  return {
    view,
    form,
    setForm,
    dirty,
    failure,
    problem,
    errors,
    sent,
    busy,
    save,
    discard,
    catalog,
    catalogError,
    chains,
    defaults,
    order,
    submitted,
  };
}

export type ObserversState = ReturnType<typeof useObservers>;
