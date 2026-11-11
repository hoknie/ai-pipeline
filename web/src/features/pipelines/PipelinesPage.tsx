import { lazy, Suspense, useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { actionsOf } from '../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelineSection } from '../../shared/lib/nav/route.ts';
import type { Api } from '../../shared/api/api.ts';
import type { RunView } from '../../shared/api/types.ts';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import { PipelinesColumns } from './page/PipelinesColumns.tsx';
import { usePipelineNavigation, type Level } from './page/usePipelineNavigation.ts';
import { usePipelinesData } from './page/usePipelinesData.ts';
import { usePipelineTabs } from './page/usePipelineTabs.ts';
import type { LiveGroup } from '../topology/index.ts';

const noop = () => undefined;
const TopologyPage = lazy(() =>
  import('../topology/index.ts').then((module) => ({ default: module.TopologyPage })),
);

export default function PipelinesPage({
  api,
  runs,
  selected,
  section: shownSection = null,
  scope: shownScope = null,
  onSelect,
  onOpenGroup,
  dirty: sharedDirty,
}: {
  api: Api;
  runs: RunView[];
  /** Id of the open pipeline, action or system stage. */
  selected: string | null;
  /** Section of `selected`: `actions`, `system`, `topology`; null for the pipelines. */
  section?: PipelineSection | string | null;
  /** Level tab of a system stage: `global`; null for the project. */
  scope?: string | null;
  onSelect: (id: string | null, section?: PipelineSection | null, level?: 'global' | null) => void;
  /** Opens a group of a run (a click on a live group of the topology). */
  onOpenGroup?: (group: LiveGroup, step: string | null) => void;
  /** Whether the open form has unsaved edits; the caller owns it to guard other navigation. */
  dirty?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const section: PipelineSection | null =
    shownSection === 'actions' || shownSection === 'system' || shownSection === 'topology'
      ? shownSection
      : null;
  const data = usePipelinesData(api);
  const { view } = data;
  const level: Level = section === 'system' && shownScope === 'global' ? 'global' : null;
  const navigation = usePipelineNavigation({ selected, section, level, dirty, onSelect });
  const actions = view ? actionsOf(view) : [];
  const tabs = usePipelineTabs({ view, actions, section, selected, level, navigation });
  const firstPipeline = view?.pipelines[0]?.id ?? null;

  // the former address `#topology` has no pipeline: open the first one
  useEffect(() => {
    if (section === 'topology' && selected === null && firstPipeline !== null)
      onSelect(firstPipeline, 'topology');
  }, [section, selected, firstPipeline, onSelect]);

  return (
    <>
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
          <TopologyPage
            api={api}
            runs={runs}
            pipeline={selected}
            onSelectPipeline={(id) => void navigation.go(id, 'topology')}
            onEditPipeline={(id) => void navigation.go(id, null)}
            onOpenGroup={onOpenGroup ?? noop}
          />
        </Suspense>
      ) : (
        <PipelinesColumns
          api={api}
          runs={runs}
          data={data}
          navigation={navigation}
          selected={selected}
          section={section}
          level={level}
          dirty={dirty}
          onSelect={onSelect}
        />
      )}
    </>
  );
}
