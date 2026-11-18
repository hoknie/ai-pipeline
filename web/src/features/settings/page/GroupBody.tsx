import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { agentTabOf, observerTabOf } from '../../../shared/lib/nav/settingsGroups.ts';
import { settingsRouteOfSwarmTarget } from '../../swarm/index.ts';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { SettingsForm } from '../../../shared/ui/forms/settings/SettingsForm.tsx';
import { ObserversGroup } from '../ObserversGroup.tsx';
import { QueueModes } from '../QueueModes.tsx';
import { SystemGroup } from '../SystemGroup.tsx';
import { TagsSettings } from '../TagsSettings.tsx';
import { AgentsGroup } from '../agents/AgentsGroup.tsx';
import { ProjectsGroup } from '../projects/ProjectsGroup.tsx';
import { RuntimesGroup } from '../runtimes/RuntimesGroup.tsx';
import type { SettingsPageProps } from './types.ts';
import type { SettingsConfig } from './useSettingsConfig.ts';

// loaded on demand: it carries the pages of the swarm
const SwarmWorkspace = lazy(() =>
  import('../../swarm/index.ts').then((module) => ({ default: module.SwarmWorkspace })),
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
  const scope = settings.config?.settings.find((entry) => entry.path === 'queue.scope')?.value;
  return (
    <>
      {scope === 'global' ? (
        <p className="mb-3 max-w-xl text-sm text-muted-foreground">
          {t('queue.settings.globalNote')}
        </p>
      ) : null}
      <QueueModes
        api={props.api}
        queue={queue}
        repositoryName={repository === null ? null : repositoryLabel(repository)}
        config={settings.config}
        onReload={settings.reload}
        onQueue={props.onQueue}
        onError={props.onError}
      />
    </>
  );
}

/** The group «Swarm»: the window with its tabs, over the whole width of the group. */
function SwarmBody({ props, settings }: BodyProps) {
  const { scope } = props;
  return (
    <Suspense fallback={<Loading />}>
      <SwarmWorkspace
        api={props.api}
        scope={scope}
        place={props.swarm}
        repository={props.repository}
        runs={props.runs}
        dirty={props.dirty}
        config={settings.config}
        onReload={settings.reload}
        hrefOf={(target) => formatRoute(settingsRouteOfSwarmTarget(scope, target))}
        onNavigate={props.onSelectSwarm}
        onOpenGroup={props.onOpenGroup}
      />
    </Suspense>
  );
}

function FormBody({ props, settings }: BodyProps) {
  const { api, scope, group } = props;
  const { config, failure, reload, setDirty } = settings;
  const [attachmentStorage, setAttachmentStorage] = useState('local');
  return (
    <>
      {config ? (
        <SettingsForm
          key={`${scope}/${group}`}
          api={api}
          config={config}
          scope={scope}
          group={group}
          projects={props.registry}
          onSaved={reload}
          onDirty={setDirty}
          onAttachmentStorage={setAttachmentStorage}
        />
      ) : failure ? null : (
        <Loading />
      )}
      {group === 'system' ? (
        <SystemGroup
          api={api}
          streamedNetwork={props.streamedNetwork}
          onRestarted={() => void reload().catch(() => undefined)}
          attachmentStorage={attachmentStorage}
        />
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
  if (group === 'queue' && props.scope === 'project')
    return <QueueBody props={props} settings={settings} />;
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
  if (group === 'runtimes' && props.scope === 'global') {
    return <RuntimesGroup props={props} settings={settings} />;
  }
  if (group === 'agents') {
    return (
      <AgentsGroup
        api={api}
        scope={props.scope}
        tab={agentTabOf(props.agentTab)}
        config={settings.config}
        reload={settings.reload}
        leave={settings.leave}
        onDirty={settings.setDirty}
      >
        <FormBody props={props} settings={settings} />
      </AgentsGroup>
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
  if (group === 'swarm') return <SwarmBody props={props} settings={settings} />;
  return <FormBody props={props} settings={settings} />;
}
