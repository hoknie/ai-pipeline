import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { observerTabOf } from '../../../shared/lib/nav/settingsGroups.ts';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { SettingsForm } from '../../../shared/ui/forms/settings/SettingsForm.tsx';
import { ObserversGroup } from '../ObserversGroup.tsx';
import { QueueModes } from '../QueueModes.tsx';
import { SharedChainsGroup } from '../SharedChainsGroup.tsx';
import { SharedSpecialistsGroup } from '../SharedSpecialistsGroup.tsx';
import { SystemGroup } from '../SystemGroup.tsx';
import { TagsSettings } from '../TagsSettings.tsx';
import { ProjectsGroup } from '../projects/ProjectsGroup.tsx';
import type { SettingsPageProps } from './types.ts';
import type { SettingsConfig } from './useSettingsConfig.ts';

// loaded on demand: it draws the pipeline graph
const SharedPipelinesGroup = lazy(() =>
  import('../SharedPipelinesGroup.tsx').then((module) => ({
    default: module.SharedPipelinesGroup,
  })),
);

function Loading() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('settings.editor.loading')}>
      <Skeleton className="h-40" />
    </div>
  );
}

type BodyProps = { props: SettingsPageProps; settings: SettingsConfig };

function QueueBody({ props, settings }: BodyProps) {
  const { t } = useTranslation();
  const { queue, repository } = props;
  if (!queue) {
    return (
      <div role="status" aria-label={t('queue.loading')}>
        <Skeleton className="h-24" />
      </div>
    );
  }
  return (
    <QueueModes
      api={props.api}
      queue={queue}
      repositoryName={repository === null ? null : repositoryLabel(repository)}
      config={settings.config}
      onReload={settings.reload}
      onQueue={props.onQueue}
      onError={props.onError}
    />
  );
}

function SharedBody({ props, settings }: BodyProps) {
  const { api, group, dirty } = props;
  const { config, failure, reload } = settings;
  if (!config) return failure ? null : <Loading />;
  if (group === 'pipelines') {
    return (
      <Suspense fallback={<Loading />}>
        <SharedPipelinesGroup
          api={api}
          config={config}
          selected={props.pipeline}
          onSelect={props.onSelectPipeline}
          onReload={reload}
          dirty={dirty}
        />
      </Suspense>
    );
  }
  if (group === 'chains') {
    return (
      <SharedChainsGroup
        api={api}
        config={config}
        selected={props.chain ?? null}
        onSelect={props.onSelectChain ?? (() => undefined)}
        onReload={reload}
        dirty={dirty}
      />
    );
  }
  return (
    <SharedSpecialistsGroup
      api={api}
      config={config}
      selected={props.specialist}
      onSelect={props.onSelectSpecialist}
      onReload={reload}
      dirty={dirty}
    />
  );
}

function FormBody({ props, settings }: BodyProps) {
  const { api, scope, group } = props;
  const { config, failure, reload, setDirty } = settings;
  return (
    <>
      {config ? (
        <SettingsForm
          key={`${scope}/${group}`}
          api={api}
          config={config}
          scope={scope}
          group={group}
          onSaved={reload}
          onDirty={setDirty}
        />
      ) : failure ? null : (
        <Loading />
      )}
      {group === 'system' ? (
        <SystemGroup api={api} onRestarted={() => void reload().catch(() => undefined)} />
      ) : null}
    </>
  );
}

/** The content of the open group: a screen of its own, or a form of the config files. */
export function GroupBody({ props, settings }: BodyProps) {
  const { api, group, repository } = props;
  if (group === 'tags') {
    return repository === null ? null : <TagsSettings api={api} repository={repository} />;
  }
  if (group === 'queue') return <QueueBody props={props} settings={settings} />;
  if (group === 'projects') {
    return (
      <ProjectsGroup
        api={api}
        registry={props.registry}
        selected={props.project}
        onSelect={props.onSelectProject}
        dirty={props.dirty}
        onRegistry={props.onRegistry}
        onMoved={props.onProjectMoved}
        onRemove={props.onRemoveProject}
        onOpen={props.onOpenProject}
      />
    );
  }
  if (group === 'observers') {
    return (
      <ObserversGroup
        api={api}
        tab={observerTabOf(props.observerTab)}
        onTab={props.onSelectObserverTab}
        streamed={props.streamedObservers}
        repositories={props.repositories}
        onDirty={settings.setDirty}
      />
    );
  }
  if (group === 'pipelines' || group === 'specialists' || group === 'chains') {
    return <SharedBody props={props} settings={settings} />;
  }
  return <FormBody props={props} settings={settings} />;
}
