import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ObserversView } from '../../../shared/api/observerTypes.ts';
import { OBSERVER_TABS, type ObserverTab } from '../../../shared/lib/nav/settingsGroups.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { groupErrors, type Form } from './form.ts';
import { GeneralTab } from './GeneralTab.tsx';
import { ProjectsTab } from './ProjectsTab.tsx';
import { SpecialistTab } from './SpecialistTab.tsx';
import { useObservers } from './useObservers.ts';

export function ObserverSettingsForm({
  api,
  tab,
  streamed,
  repositories,
  onDirty,
  onErrors,
}: {
  api: Api;
  tab: ObserverTab;
  onTab: (tab: ObserverTab) => void;
  streamed: ObserversView | null;
  repositories: string[];
  onDirty: (dirty: boolean) => void;
  /** The tabs with errors, reported again only when the list changes. */
  onErrors?: (tabs: ObserverTab[]) => void;
}) {
  const { t } = useTranslation();
  const state = useObservers(api, streamed, repositories, onDirty);
  const { view, form, setForm, busy, problem, order } = state;
  const errors = groupErrors(state.errors, state.sent, order);

  // A new check function comes with every render: report the list of tabs, not the function.
  const failing = OBSERVER_TABS.filter((tab) => errors.tabHasErrors(tab)).join(',');
  useEffect(() => {
    onErrors?.(failing === '' ? [] : (failing.split(',') as ObserverTab[]));
  }, [failing, onErrors]);

  if (state.failure) return <Alert variant="destructive">{state.failure}</Alert>;
  if (!form || !view || !state.submitted) {
    return (
      <div role="status" aria-label={t('observers.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }
  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  return (
    <div className="flex flex-col gap-3">
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {errors.other.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {errors.other.map((error) => (
              <li key={`${error.path}:${error.message}`}>
                <code>{error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {tab === 'general' ? (
        <GeneralTab form={form} update={update} busy={busy} errors={errors} view={view} />
      ) : null}
      {tab === 'specialist' ? (
        <SpecialistTab
          form={form}
          setForm={setForm}
          busy={busy}
          errors={errors.specialist}
          defaults={state.defaults}
          catalog={state.catalog}
          catalogError={state.catalogError}
        />
      ) : null}
      {tab === 'projects' ? (
        <ProjectsTab form={form} update={update} busy={busy} order={order} errors={errors} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={!state.dirty} onClick={() => void state.save()}>
          {t('settingsPage.save')}
        </Button>
        <Button variant="outline" disabled={busy || !state.dirty} onClick={state.discard}>
          {t('settingsPage.discard')}
        </Button>
      </div>
    </div>
  );
}
