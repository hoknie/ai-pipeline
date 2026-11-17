import { lazy, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { actionsOf } from '../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelineSection } from '../../shared/lib/nav/route.ts';
import type { Api } from '../../shared/api/api.ts';
import type { RunView } from '../../shared/api/types.ts';
import { type ProjectsMode } from '../repositories/index.ts';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { ModelCatalogProvider } from '../../shared/lib/catalog/models.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import { usePipelinesScope } from './page/usePipelinesScope.tsx';
import { PipelinesColumns } from './page/PipelinesColumns.tsx';
import { usePipelineTabs } from './page/usePipelineTabs.ts';
import type { LiveGroup } from '../topology/index.ts';

const noop = () => undefined;
const TopologyPage = lazy(() =>
  import('../topology/index.ts').then((module) => ({ default: module.TopologyPage })),
);

interface PipelinesPageProps {
  /** Set in the mode «All projects»: the lists group the projects and only show them. */
  projects?: ProjectsMode;
  api: Api;
  runs: RunView[];
  /** Id of the open pipeline, action or system stage. */
  selected: string | null;
  /** Section of `selected`: `actions`, `system`, `topology`; null for the pipelines. */
  section?: PipelineSection | string | null;
  /** The variant of the topology (`#pipelines/topology/<id>/<variant>`); null: `default`. */
  variant?: string | null;
  onSelect: (
    id: string | null,
    section?: PipelineSection | null,
    variant?: string | null,
    project?: string | null,
  ) => void;
  /** Opens a group of a run (a click on a live group of the topology). */
  onOpenGroup?: (group: LiveGroup, step: string | null) => void;
  /** Opens an entry in the form of a project (leaves the mode «All projects»). */
  onOpenInProject?: ((path: string, entry: string, section?: string | null) => void) | undefined;
  /** Whether the open form has unsaved edits; the caller owns it to guard other navigation. */
  dirty?: RefObject<boolean>;
}

export default function PipelinesPage({
  api,
  runs,
  selected,
  section: shownSection = null,
  variant = null,
  onSelect,
  onOpenGroup,
  onOpenInProject,
  dirty: sharedDirty,
  projects,
}: PipelinesPageProps) {
  const { t } = useTranslation();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const section: PipelineSection | null =
    shownSection === 'actions' || shownSection === 'system' || shownSection === 'topology'
      ? shownSection
      : null;
  const scope = usePipelinesScope({ api, projects, section, selected, dirty, onSelect });
  const { listMode, picker, tabApi, data, navigation } = scope;
  const { view } = data;
  const actions = view ? actionsOf(view) : [];
  const tabs = usePipelineTabs({ view, actions, section, selected, navigation });
  const firstPipeline = view?.pipelines[0]?.id ?? null;

  // the former address `#topology` has no pipeline: open the first one
  useEffect(() => {
    if (section === 'topology' && selected === null && firstPipeline !== null)
      onSelect(firstPipeline, 'topology');
  }, [section, selected, firstPipeline, onSelect]);

  return (
    <ModelCatalogProvider api={api}>
      <div className="px-4 pt-3">
        <LinkTabs label={t('pipeline.tabs')} tabs={tabs} />
      </div>
      {section === 'topology' ? (
        <Suspense
          fallback={
            <div role="status" aria-label={t('app.loading', { what: t('app.loadingGraph') })}>
              <Skeleton className="m-4 h-40" />
            </div>
          }
        >
          {picker}
          <TopologyPage
            api={tabApi}
            runs={runs}
            pipeline={selected}
            variant={variant}
            onSelectVariant={(next) => selected && onSelect(selected, 'topology', next)}
            onSelectPipeline={(id) => void navigation.go(id, 'topology')}
            onEditPipeline={(id) => void navigation.go(id, null)}
            onOpenGroup={onOpenGroup ?? noop}
          />
        </Suspense>
      ) : (
        <>
          {picker}
          <PipelinesColumns
            api={tabApi}
            runs={runs}
            data={data}
            navigation={navigation}
            selected={selected}
            section={section}
            dirty={dirty}
            onSelect={scope.choose}
            projects={listMode ? projects : undefined}
            onOpenInProject={onOpenInProject}
          />
        </>
      )}
    </ModelCatalogProvider>
  );
}
