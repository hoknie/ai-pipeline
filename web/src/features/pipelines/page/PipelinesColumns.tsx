import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../../shared/lib/browser/media.ts';
import type { Api } from '../../../shared/api/api.ts';
import { rowKey, splitRowKey } from '../../../shared/lib/catalog/projectRows.ts';
import { useNewEntry, type ProjectsMode } from '../../repositories/index.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { FiltersPanel } from './FiltersControl.tsx';
import { ImportHost } from './ImportHost.tsx';
import { PipelinesBody, type BodyProps } from './PipelinesBody.tsx';
import { PipelinesSide } from './PipelinesSide.tsx';
import { dataIn, type EntryContext } from './useMergedData.ts';
import { usePipelineFilterState } from './usePipelineFilterState.ts';
import type { PipelineNavigation } from './usePipelineNavigation.ts';
import type { PipelinesData } from './usePipelinesData.ts';

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
  /** Set in the mode «All projects»: the list merges the projects. */
  projects?: ProjectsMode | undefined;
  /** The api and the configuration of the project of an entry; absent outside the mode. */
  contextOf?: ((key: string | null) => EntryContext) | undefined;
}) {
  const { t } = useTranslation();
  const { data, navigation, selected, section, contextOf, projects } = props;
  const { view } = data;
  const [importing, setImporting] = useState<string | null | false>(false);
  const newEntry = useNewEntry(
    projects,
    (project) => void navigation.go(rowKey(project, 'new'), section),
  );
  const importer = useNewEntry(projects, (project) => setImporting(project));
  const open = splitRowKey(selected ?? '');
  const body = contextOf?.(selected);
  const importContext = contextOf?.(
    importing === false || importing === null ? null : rowKey(importing, ''),
  );
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
          onNew={newEntry.ask}
          onImport={() => (projects ? importer.ask() : setImporting(null))}
        />
      }
    >
      <PipelinesBody
        api={body?.api ?? props.api}
        runs={props.runs}
        data={dataIn(data, body)}
        navigation={navigation}
        selected={contextOf ? open.id : selected}
        section={section}
        dirty={props.dirty}
        onSelect={(id, next) => props.onSelect(id === null ? null : rowKey(body?.slug, id), next)}
      />
      {newEntry.dialog}
      {importer.dialog}
      <ImportHost
        api={importContext?.api ?? props.api}
        data={dataIn(data, importContext)}
        repository={importContext?.view?.repository ?? filters.repository}
        open={importing !== false}
        onOpenChange={(next) => setImporting(next ? null : false)}
      />
    </SplitPage>
  );
}
