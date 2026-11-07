import { Download, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ConfigErrors, EntryList } from '../../../shared/ui/layout/EntryList.tsx';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import {
  SYSTEM_KINDS,
  actionsOf,
  type ActionEntry,
} from '../../../shared/lib/pipeline/pipelineEntries.ts';
import {
  LEVEL_KEYS,
  NEW_ID,
  SpecialistTagChip,
  tagsOfSpecialist,
} from '../../specialists/index.ts';
import {
  EMPTY_PIPELINE_FILTER,
  activePipelineFilterCount,
  applyPipelineFilter,
} from '../pipelineFilters.ts';
import { stageLevel } from '../SystemStagePage.tsx';
import { FiltersControl } from './FiltersControl.tsx';
import type { PipelinesData } from './usePipelinesData.ts';
import type { PipelineFilterState } from './usePipelineFilterState.ts';
import type { Level } from './usePipelineNavigation.ts';

type Go = (
  id: string | null,
  section?: 'actions' | 'system' | null,
  level?: Level,
) => Promise<void>;
type Section = 'actions' | 'system' | null;

const levelTag = (t: TFunction) => (level: 'project' | 'global' | 'project_over_global') =>
  t(`settings.editor.levels.${LEVEL_KEYS[level]}`);

function PipelineList(props: {
  view: ConfigEditorResponse | null;
  filters: PipelineFilterState;
  shown: ConfigEditorResponse['pipelines'];
  count: number;
  filtersControl: boolean;
  wide: boolean;
  selected: string | null;
  go: Go;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const { view, filters, shown, count, go } = props;
  return (
    <>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => void go(NEW_ID)}>
          <Plus />
          {t('pipelines.new')}
        </Button>
        <Button variant="outline" disabled={!view} onClick={props.onImport}>
          <Download />
          {t('pipelines.import.open')}
        </Button>
      </div>
      {props.filtersControl ? (
        <FiltersControl filters={filters} count={count} wide={props.wide} />
      ) : null}
      {view && shown.length === 0 && count > 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>{t('pipelines.filters.nothing')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              filters.setFilter(EMPTY_PIPELINE_FILTER);
              filters.setSearch('');
            }}
          >
            {t('pipelines.filters.reset')}
          </Button>
        </div>
      ) : null}
      <EntryList
        label="pipeline"
        selected={props.selected}
        onSelect={(id) => void go(id)}
        entries={shown.map((entry) => ({
          id: entry.id,
          title: rawName(entry.raw) ?? entry.id,
          hint: entry.id,
          tag: t(`settings.editor.levels.${LEVEL_KEYS[entry.level]}`),
          extra:
            tagsOfSpecialist(entry).length > 0 ? (
              <span data-testid={`tags-${entry.id}`} className="flex flex-wrap gap-1">
                {tagsOfSpecialist(entry).map((tag) => (
                  <SpecialistTagChip
                    key={tag.name}
                    name={tag.name}
                    shared={tag.shared}
                    hint={t('pipelines.tagsSharedHint')}
                  />
                ))}
              </span>
            ) : undefined,
        }))}
      />
    </>
  );
}

function ActionList(props: {
  view: ConfigEditorResponse | null;
  actions: ActionEntry[];
  selected: string | null;
  go: Go;
}) {
  const { t } = useTranslation();
  const { go } = props;
  return (
    <>
      <Button variant="outline" disabled={!props.view} onClick={() => void go(NEW_ID, 'actions')}>
        <Plus />
        {t('pipeline.actions.new')}
      </Button>
      <EntryList
        label={t('pipeline.sections.actions')}
        selected={props.selected}
        onSelect={(id) => void go(id, 'actions')}
        entries={props.actions.map((entry) => ({
          id: entry.id,
          title:
            typeof entry.raw.name === 'string' && entry.raw.name !== '' ? entry.raw.name : entry.id,
          hint: entry.id,
          tag: levelTag(t)(entry.level),
          subtitle: entry.id,
        }))}
      />
    </>
  );
}

/** The left column: the list of the open tab with its buttons. */
export function PipelinesSide(props: {
  section: Section;
  selected: string | null;
  data: PipelinesData;
  level: Level;
  filters: PipelineFilterState;
  filtersControl: boolean;
  wide: boolean;
  go: Go;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const { section, selected, go, filters } = props;
  const { view, failure, stages } = props.data;
  const actions = view ? actionsOf(view) : [];
  const shown = applyPipelineFilter(view?.pipelines ?? [], filters.filter, filters.search);
  const count = activePipelineFilterCount(filters.filter, filters.search);
  return (
    <>
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {view ? <ConfigErrors errors={view.errors} /> : null}
      {section === null ? (
        <PipelineList {...props} view={view} shown={shown} count={count} />
      ) : null}
      {section === 'actions' ? (
        <ActionList view={view} actions={actions} selected={selected} go={go} />
      ) : null}
      {section === 'system' ? (
        <EntryList
          label={t('pipeline.sections.system')}
          selected={selected}
          onSelect={(id) => void go(id, 'system', props.level)}
          entries={SYSTEM_KINDS.map((kind) => ({
            id: kind,
            title: t(`pipeline.system.kinds.${kind}`),
            hint: kind,
            tag: levelTag(t)(
              stageLevel(stages?.stages.find((candidate) => candidate.kind === kind)),
            ),
          }))}
        />
      ) : null}
    </>
  );
}
