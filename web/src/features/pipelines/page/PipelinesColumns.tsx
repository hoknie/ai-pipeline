import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../../shared/lib/browser/media.ts';
import type { Api } from '../../../shared/api/api.ts';
import type { EditorPipeline, RunView } from '../../../shared/api/types.ts';
import type { Grouped } from '../../../shared/lib/catalog/projectRows.ts';
import { actionsOf, type ActionEntry } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import type { ProjectsMode } from '../../repositories/index.ts';
import { ActionOverview, PipelineOverview } from '../overview/PipelineOverview.tsx';
import { FiltersPanel } from './FiltersControl.tsx';
import { ImportHost } from './ImportHost.tsx';
import { PipelinesBody, type BodyProps } from './PipelinesBody.tsx';
import { PipelinesSide } from './PipelinesSide.tsx';
import { usePipelineFilterState } from './usePipelineFilterState.ts';
import type { PipelineNavigation } from './usePipelineNavigation.ts';
import type { PipelinesData } from './usePipelinesData.ts';
import { useState } from 'react';

/** The list of the open tab (pipelines, actions, system stages) and its form. */
export function PipelinesColumns(props: {
  api: Api;
  runs: RunView[];
  data: PipelinesData;
  navigation: PipelineNavigation;
  selected: string | null;
  section: BodyProps['section'];
  dirty: RefObject<boolean>;
  onSelect: BodyProps['onSelect'];
  /** Set in the mode «All projects»: the lists group the projects and only show them. */
  projects?: ProjectsMode | undefined;
  /** Opens an entry in the form of a project (leaves the mode). */
  onOpenInProject?: ((path: string, entry: string, section?: string | null) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { data, navigation, selected, section, projects } = props;
  const { view } = data;
  const [importing, setImporting] = useState(false);
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const filters = usePipelineFilterState(view);

  return (
    <SplitPage
      filters={columns && section === null && view ? <FiltersPanel filters={filters} /> : null}
      filtersLabel={t('pipelines.filters.button')}
      filtersCount={filters.count}
      filtersCountLabel={t('pipelines.filters.buttonCount', { count: filters.count })}
      filtersCollapsed={filters.collapsed}
      onFiltersCollapsed={filters.setCollapsed}
      side={
        <PipelinesSide
          section={section}
          selected={selected}
          data={data}
          filters={filters}
          filtersControl={!!view && !columns && section === null}
          wide={wide}
          go={navigation.go}
          readOnly={projects !== undefined}
          onNew={() => void navigation.go('new', section)}
          onImport={() => setImporting(true)}
        />
      }
    >
      {projects ? (
        <Overview {...props} projects={projects} />
      ) : (
        <>
          <PipelinesBody
            api={props.api}
            runs={props.runs}
            data={data}
            navigation={navigation}
            selected={selected}
            section={section}
            dirty={props.dirty}
            onSelect={props.onSelect}
          />
          <ImportHost
            api={props.api}
            data={data}
            repository={filters.repository}
            open={importing}
            onOpenChange={setImporting}
          />
        </>
      )}
    </SplitPage>
  );
}

/** The open pipeline or action of the mode «All projects»: an overview instead of a form. */
function Overview(props: {
  data: PipelinesData;
  selected: string | null;
  section: BodyProps['section'];
  projects: ProjectsMode;
  onOpenInProject?: ((path: string, entry: string, section?: string | null) => void) | undefined;
}) {
  const { data, selected, section, projects } = props;
  const { view } = data;
  const open = (path: string) => props.onOpenInProject?.(path, selected ?? '', section);
  if (view === null || selected === null) return null;
  if (section === null) {
    const row = (view.pipelines as Grouped<EditorPipeline>[]).find((item) => item.id === selected);
    return row ? <PipelineOverview row={row} highlight={projects.project} onOpen={open} /> : null;
  }
  if (section !== 'actions') return null;
  const row = (actionsOf(view) as Grouped<ActionEntry>[]).find((item) => item.id === selected);
  return row ? <ActionOverview row={row} highlight={projects.project} onOpen={open} /> : null;
}
