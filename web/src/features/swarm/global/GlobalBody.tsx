import { lazy, Suspense } from 'react';

import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { ProvidersPage } from '../../providers/index.ts';
import type { SwarmWorkspaceProps } from '../types/props.ts';
import { SharedChainsGroup } from './SharedChainsGroup.tsx';
import { SharedSpecialistsGroup } from './SharedSpecialistsGroup.tsx';

// loaded on demand: it draws the pipeline graph
const SharedPipelinesGroup = lazy(() =>
  import('./SharedPipelinesGroup.tsx').then((module) => ({ default: module.SharedPipelinesGroup })),
);

function Loading() {
  return <Skeleton className="h-40" />;
}

/** The body of a tab of the shared area: the files of the shared directory only. */
export function GlobalBody(props: SwarmWorkspaceProps) {
  const { api, place, repository, runs, dirty, config, onNavigate } = props;
  const reload = props.onReload ?? (() => Promise.resolve());
  if (place.tab === 'providers' || place.tab === 'roles') {
    return (
      <ProvidersPage
        api={api}
        repository={repository}
        runs={runs}
        scope="global"
        selected={place.tab === 'roles' ? null : place.entry}
        section={place.tab === 'roles' ? 'roles' : null}
        preset={place.preset ?? null}
        project={null}
        hrefOfNew={(preset) => props.hrefOf({ tab: 'providers', entry: 'new', preset })}
        onSelect={(run, section = null, preset = null) =>
          onNavigate(
            section === 'roles'
              ? { tab: 'roles', entry: null }
              : { tab: 'providers', entry: run, preset },
          )
        }
      />
    );
  }
  if (!config) return <Loading />;
  const select = (tab: 'chains' | 'specialists' | 'pipelines') => (entry: string | null) =>
    onNavigate({ tab, entry });
  if (place.tab === 'pipelines') {
    return (
      <Suspense fallback={<Loading />}>
        <SharedPipelinesGroup
          api={api}
          config={config}
          selected={place.entry}
          onSelect={select('pipelines')}
          onReload={reload}
          dirty={dirty}
        />
      </Suspense>
    );
  }
  if (place.tab === 'chains') {
    return (
      <SharedChainsGroup
        api={api}
        config={config}
        selected={place.entry}
        onSelect={select('chains')}
        onReload={reload}
        dirty={dirty}
      />
    );
  }
  return (
    <SharedSpecialistsGroup
      api={api}
      config={config}
      selected={place.entry}
      onSelect={select('specialists')}
      onReload={reload}
      dirty={dirty}
    />
  );
}
