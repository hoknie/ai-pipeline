import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { actionsOf } from '../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelineSection } from '../../shared/lib/nav/route.ts';
import type { Api } from '../../shared/api/api.ts';
import type { RunView } from '../../shared/api/types.ts';
import { SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import { FiltersPanel } from './page/FiltersControl.tsx';
import { PipelinesBody } from './page/PipelinesBody.tsx';
import { PipelinesSide } from './page/PipelinesSide.tsx';
import { usePipelineFilterState } from './page/usePipelineFilterState.ts';
import { usePipelineNavigation, type Level } from './page/usePipelineNavigation.ts';
import { usePipelinesData } from './page/usePipelinesData.ts';
import { usePipelineTabs } from './page/usePipelineTabs.ts';
import { ImportHost } from './page/ImportHost.tsx';

export default function PipelinesPage({
  api,
  runs,
  selected,
  section: shownSection = null,
  scope: shownScope = null,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  runs: RunView[];
  /** Id of the open pipeline, action or system stage. */
  selected: string | null;
  /** Section of `selected`: `actions`, `system`; null for the pipelines. */
  section?: PipelineSection | string | null;
  /** Level tab of a system stage: `global`; null for the project. */
  scope?: string | null;
  onSelect: (id: string | null, section?: PipelineSection | null, level?: 'global' | null) => void;
  /** Whether the open form has unsaved edits; the caller owns it to guard other navigation. */
  dirty?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const [importing, setImporting] = useState(false);
  const section: PipelineSection | null =
    shownSection === 'actions' || shownSection === 'system' ? shownSection : null;
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const data = usePipelinesData(api);
  const { view } = data;
  const filters = usePipelineFilterState(view);
  const level: Level = section === 'system' && shownScope === 'global' ? 'global' : null;
  const navigation = usePipelineNavigation({ selected, section, level, dirty, onSelect });
  const actions = view ? actionsOf(view) : [];
  const tabs = usePipelineTabs({ view, actions, section, selected, level, navigation });

  return (
    <>
      <div className="px-4 pt-3">
        <LinkTabs label={t('pipeline.tabs')} tabs={tabs} />
      </div>
      <SplitPage
        filters={columns && section === null && view ? <FiltersPanel filters={filters} /> : null}
        filtersLabel={t('pipelines.filters.button')}
        side={
          <PipelinesSide
            section={section}
            selected={selected}
            data={data}
            level={level}
            filters={filters}
            filtersControl={!!view && !columns && section === null}
            wide={wide}
            go={navigation.go}
            onImport={() => setImporting(true)}
          />
        }
      >
        <PipelinesBody
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
        <ImportHost
          api={api}
          data={data}
          filters={filters}
          open={importing}
          onOpenChange={setImporting}
        />
      </SplitPage>
    </>
  );
}
