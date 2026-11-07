import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { ObserversView } from '../../shared/api/observerTypes.ts';
import type { ObserverTab } from '../../shared/lib/nav/settingsGroups.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { groupErrors, type Form } from './observers/form.ts';
import { GeneralTab } from './observers/GeneralTab.tsx';
import { ObserverTabs } from './observers/ObserverTabs.tsx';
import { ProjectsTab } from './observers/ProjectsTab.tsx';
import { SpecialistTab } from './observers/SpecialistTab.tsx';
import { useObservers } from './observers/useObservers.ts';

/**
 * The group «Observers» of the shared tab: the switch and limits, the specialist of the observer
 * and the projects it works in. The three tabs edit one form, saved in one go.
 */
export function ObserversGroup({
  api,
  tab,
  onTab,
  streamed,
  repositories,
  onDirty,
}: {
  api: Api;
  tab: ObserverTab;
  onTab: (tab: ObserverTab) => void;
  /** The last `observers` event of the stream: the settings changed elsewhere. */
  streamed: ObserversView | null;
  /** The repositories of the registry, the choices of the tab «Projects». */
  repositories: string[];
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const state = useObservers(api, streamed, repositories, onDirty);
  const { view, form, setForm, busy, problem, order } = state;
  if (state.failure) return <Alert variant="destructive">{state.failure}</Alert>;
  if (!form || !view || !state.submitted) {
    return (
      <div role="status" aria-label={t('observers.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }
  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const errors = groupErrors(state.errors, state.sent, order);
  return (
    <div className="flex flex-col gap-3">
      <ObserverTabs tab={tab} onTab={onTab} tabHasErrors={errors.tabHasErrors} />
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
