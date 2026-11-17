import { lazy, Suspense } from 'react';

import { ProvidersPage } from '../../providers/index.ts';
import { SpecialistsPage } from '../../specialists/index.ts';
import type { SwarmWorkspaceProps } from '../types/props.ts';

// loaded on demand: it draws the pipeline graph
const PipelinesPage = lazy(() =>
  import('../../pipelines/index.ts').then((module) => ({ default: module.PipelinesPage })),
);

/** The body of a tab of the project area: the pages of the selected project (or of all of them). */
export function ProjectBody(
  props: SwarmWorkspaceProps & { usage?: ((slug: string) => React.ReactNode) | undefined },
) {
  const { api, place, repository, runs, dirty, projects, onNavigate } = props;
  const project = place.project ?? null;
  if (place.tab === 'providers' || place.tab === 'roles') {
    return (
      <ProvidersPage
        api={api}
        repository={repository}
        runs={runs}
        selected={place.tab === 'roles' ? null : place.entry}
        section={place.tab === 'roles' ? 'roles' : null}
        preset={place.preset ?? null}
        project={project}
        projects={projects}
        usage={props.usage}
        hrefOfNew={(preset) => props.hrefOf({ tab: 'providers', entry: 'new', preset, project })}
        onSelect={(run, section = null, preset = null, owner = null) =>
          onNavigate(
            section === 'roles'
              ? { tab: 'roles', entry: null }
              : { tab: 'providers', entry: run, preset, project: owner },
          )
        }
      />
    );
  }
  if (place.tab === 'pipelines') {
    return (
      <Suspense fallback={null}>
        <PipelinesPage
          dirty={dirty}
          api={api}
          runs={runs}
          selected={place.entry}
          section={place.section ?? null}
          variant={place.variant ?? null}
          projects={projects ? { ...projects, project } : undefined}
          onSelect={(id, section = null, variant = null, owner = null) =>
            onNavigate({ tab: 'pipelines', entry: id, section, variant, project: owner })
          }
          onOpenGroup={props.onOpenGroup}
        />
      </Suspense>
    );
  }
  return (
    <SpecialistsPage
      dirty={dirty}
      api={api}
      selected={place.entry}
      section={place.tab === 'chains' ? 'chains' : null}
      projects={projects ? { ...projects, project } : undefined}
      onProviders={() => onNavigate({ tab: 'providers', entry: null })}
      onSelect={(id, section = null, owner = null) =>
        onNavigate({
          tab: section === 'chains' ? 'chains' : 'specialists',
          entry: id,
          project: owner,
        })
      }
    />
  );
}
