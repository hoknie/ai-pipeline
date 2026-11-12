import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../../shared/lib/browser/media.ts';
import type { Api } from '../../../shared/api/api.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { FiltersPanel } from './FiltersControl.tsx';
import { ImportHost } from './ImportHost.tsx';
import { PipelinesBody, type BodyProps } from './PipelinesBody.tsx';
import { PipelinesSide } from './PipelinesSide.tsx';
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
}) {
  const { t } = useTranslation();
  const { data, navigation, selected, section } = props;
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
          onImport={() => setImporting(true)}
        />
      }
    >
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
        filters={filters}
        open={importing}
        onOpenChange={setImporting}
      />
    </SplitPage>
  );
}
