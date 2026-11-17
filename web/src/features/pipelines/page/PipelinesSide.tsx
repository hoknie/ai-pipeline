import { Download, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ConfigErrors, EntryList } from '../../../shared/ui/layout/EntryList.tsx';
import { FiltersButton } from '../../../shared/ui/layout/FiltersButton.tsx';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import {
  SYSTEM_KINDS,
  actionsOf,
  type ActionEntry,
} from '../../../shared/lib/pipeline/pipelineEntries.ts';
import type { GroupInfo } from '../../../shared/lib/catalog/projectRows.ts';
import { ProjectChips, ReadOnlyHint } from '../../repositories/index.ts';
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
import { VariantBadges } from './VariantBadges.tsx';
import { stageLevel } from '../SystemStagePage.tsx';
import { FiltersPanel } from './FiltersControl.tsx';
import type { PipelinesData } from './usePipelinesData.ts';
import type { PipelineFilterState } from './usePipelineFilterState.ts';

type Go = (id: string | null, section?: 'actions' | 'system' | null) => Promise<void>;
type Section = 'actions' | 'system' | null;

function Chips({ row }: { row: GroupInfo }) {
  return row.presences ? (
    <ProjectChips everywhere={row.everywhere === true} presences={row.presences} />
  ) : null;
}

const levelTag = (t: TFunction) => (level: 'project' | 'global' | 'project_over_global') =>
  t(`settings.editor.levels.${LEVEL_KEYS[level]}`);

/** The hint for a filter that leaves no pipeline, and the button that clears it. */
function NothingFound({ filters }: { filters: PipelineFilterState }) {
  const { t } = useTranslation();
  return (
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
  );
}

function PipelineList(props: {
  view: ConfigEditorResponse | null;
  filters: PipelineFilterState;
  shown: (ConfigEditorResponse['pipelines'][number] & GroupInfo)[];
  count: number;
  filtersControl: boolean;
  wide: boolean;
  selected: string | null;
  go: Go;
  readOnly: boolean;
  onNew?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { view, filters, shown, count, go } = props;
  return (
    <>
      {props.readOnly ? (
        <ReadOnlyHint />
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" onClick={props.onNew}>
            <Plus />
            {t('pipelines.new')}
          </Button>
          <Button variant="outline" disabled={!view} onClick={props.onImport}>
            <Download />
            {t('pipelines.import.open')}
          </Button>
        </div>
      )}
      {props.filtersControl ? (
        <FiltersButton
          label={t('pipelines.filters.button')}
          countLabel={count > 0 ? t('pipelines.filters.buttonCount', { count }) : null}
          wide={props.wide}
        >
          <FiltersPanel filters={filters} />
        </FiltersButton>
      ) : null}
      {view && shown.length === 0 && count > 0 ? <NothingFound filters={filters} /> : null}
      <EntryList
        label="pipeline"
        selected={props.selected}
        onSelect={(id) => void go(id)}
        entries={shown.map((entry) => ({
          id: entry.id,
          title: rawName(entry.raw) ?? entry.id,
          hint: entry.id,
          tag: t(`settings.editor.levels.${LEVEL_KEYS[entry.level]}`),
          extra: (
            <>
              <Chips row={entry} />
              <VariantBadges id={entry.id} raw={entry.raw} />
              {tagsOfSpecialist(entry).length > 0 ? (
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
              ) : null}
            </>
          ),
        }))}
      />
    </>
  );
}

function ActionList(props: {
  view: ConfigEditorResponse | null;
  actions: (ActionEntry & GroupInfo)[];
  selected: string | null;
  go: Go;
  readOnly: boolean;
  onNew?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { go } = props;
  return (
    <>
      {props.readOnly ? (
        <ReadOnlyHint />
      ) : (
        <Button variant="outline" disabled={!props.view} onClick={props.onNew}>
          <Plus />
          {t('pipeline.actions.new')}
        </Button>
      )}
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
          extra: <Chips row={entry} />,
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
  filters: PipelineFilterState;
  filtersControl: boolean;
  wide: boolean;
  go: Go;
  /** The mode «All projects»: the lists only show, nothing is created or imported. */
  readOnly?: boolean;
  onNew?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { section, selected, go, filters } = props;
  const { view, failure, stages } = props.data;
  const actions: (ActionEntry & GroupInfo)[] = view ? actionsOf(view) : [];
  const shown = applyPipelineFilter(view?.pipelines ?? [], filters.filter, filters.search);
  const count = activePipelineFilterCount(filters.filter, filters.search);
  return (
    <>
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {view ? <ConfigErrors errors={view.errors} /> : null}
      {section === null ? (
        <PipelineList
          {...props}
          readOnly={props.readOnly === true}
          view={view}
          shown={shown}
          count={count}
        />
      ) : null}
      {section === 'actions' ? (
        <ActionList
          view={view}
          actions={actions}
          selected={selected}
          go={go}
          readOnly={props.readOnly === true}
          onNew={props.onNew}
        />
      ) : null}
      {section === 'system' ? (
        <EntryList
          label={t('pipeline.sections.system')}
          selected={selected}
          onSelect={(id) => void go(id, 'system')}
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
