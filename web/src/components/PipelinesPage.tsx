import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { Download, GitBranch, ListFilter, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useConfirm } from '../confirm.tsx';
import { useMediaQuery } from '../media.ts';
import { notifySuccess } from '../notify.ts';
import {
  SYSTEM_KINDS,
  actionsOf,
  isSystemKind,
  type SystemStagesResponse,
} from '../pipelineEntries.ts';
import { formatRoute, type PipelineSection } from '../route.ts';
import { usePreference } from '../preferences.ts';
import { tagsOfSpecialist } from '../specialistTags.ts';
import {
  EMPTY_PIPELINE_FILTER,
  activePipelineFilterCount,
  applyPipelineFilter,
  existingPipelineFilter,
  savedPipelineFilter,
  pipelineFilterOptions,
  type PipelineFilter,
} from '../pipelineFilters.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet.tsx';
import { Skeleton } from '../ui/skeleton.tsx';
import type { Api } from '../api.ts';
import type { ConfigEditorResponse, RunView } from '../types.ts';

import { ActionForm } from './ActionForm.tsx';
import { ConfigErrors, EntryList, SplitPage } from './EntryList.tsx';
import { LinkTabs } from './LinkTabs.tsx';
import { stageLevel, SystemStagePage } from './SystemStagePage.tsx';
import { LEVEL_KEYS, NEW_ID } from './SpecialistsPage.tsx';
import { SpecialistTagChip } from './SpecialistTagChip.tsx';
import { PipelineFilters } from './PipelineFilters.tsx';
import { PipelineForm } from './PipelineForm.tsx';
import { PipelineImportDialog } from './PipelineImportDialog.tsx';
import { rawName } from './pipelineName.ts';

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
  const [view, setView] = useState<ConfigEditorResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirm();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const [importing, setImporting] = useState(false);
  const [stages, setStages] = useState<SystemStagesResponse | null>(null);
  const [stagesFailure, setStagesFailure] = useState<string | null>(null);
  const section: PipelineSection | null =
    shownSection === 'actions' || shownSection === 'system' ? shownSection : null;
  // the filters are kept per repository
  const [savedByRepository, setSavedByRepository] = usePreference<Record<string, unknown>>(
    'pipelineFilters',
    {},
  );
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const [search, setSearch] = useState('');
  const repository = view?.repository ?? null;
  const options = useMemo(() => pipelineFilterOptions(view?.pipelines ?? []), [view]);
  const stored = useMemo<PipelineFilter>(
    () =>
      repository === null
        ? EMPTY_PIPELINE_FILTER
        : savedPipelineFilter(savedByRepository[repository]),
    [savedByRepository, repository],
  );
  const filter = useMemo(() => existingPipelineFilter(stored, options), [stored, options]);
  const setFilter = (next: PipelineFilter) => {
    if (repository === null) return;
    setSavedByRepository({ ...savedByRepository, [repository]: next });
  };
  // a value nobody has any more drops out of the saved choice
  useEffect(() => {
    if (view && repository !== null && JSON.stringify(filter) !== JSON.stringify(stored)) {
      setSavedByRepository({ ...savedByRepository, [repository]: filter });
    }
  }, [view, repository, filter, stored, savedByRepository, setSavedByRepository]);

  const load = useCallback(async () => {
    try {
      const loaded = await api.config();
      setView(loaded);
      setFailure(null);
      return loaded;
    } catch (error) {
      setFailure((error as Error).message);
      return null;
    }
  }, [api]);

  const loadStages = useCallback(async () => {
    try {
      setStages(await api.systemStages());
      setStagesFailure(null);
    } catch (error) {
      setStagesFailure((error as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void load();
    void loadStages();
  }, [load, loadStages]);

  const level: 'global' | null = section === 'system' && shownScope === 'global' ? 'global' : null;
  // the last open entry of each tab, so that coming back opens it again
  const lastOpen = useRef<Record<'pipelines' | 'actions' | 'system', string | undefined>>({
    pipelines: undefined,
    actions: undefined,
    system: undefined,
  });
  useEffect(() => {
    if (selected !== null && selected !== NEW_ID)
      lastOpen.current[section ?? 'pipelines'] = selected;
  }, [selected, section]);

  const go = async (
    id: string | null,
    next: PipelineSection | null = null,
    nextLevel: 'global' | null = null,
  ) => {
    if (id === selected && next === section && nextLevel === level) return;
    if (
      dirty.current &&
      !(await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    dirty.current = false;
    setNotice(null);
    if (next === null) onSelect(id);
    else if (nextLevel === null) onSelect(id, next);
    else onSelect(id, next, nextLevel);
  };

  const pipeline =
    section === null
      ? (view?.pipelines.find((candidate) => candidate.id === selected) ?? null)
      : null;
  const actions = view ? actionsOf(view) : [];
  const action =
    section === 'actions' ? (actions.find((candidate) => candidate.id === selected) ?? null) : null;
  /** Where a tab leads: the entry last open on it, else the default one. */
  const targetOf = (tab: 'pipelines' | 'actions' | 'system'): string | null => {
    const last = lastOpen.current[tab];
    if (tab === 'pipelines')
      return last !== undefined && view?.pipelines.some((entry) => entry.id === last) ? last : null;
    if (tab === 'system') return isSystemKind(last ?? null) ? (last as string) : SYSTEM_KINDS[0];
    return last !== undefined && actions.some((entry) => entry.id === last)
      ? last
      : (actions[0]?.id ?? NEW_ID);
  };
  const tabs = (['pipelines', 'actions', 'system'] as const).map((tab) => {
    const target = tab === 'actions' && !view ? null : targetOf(tab);
    const nextSection = tab === 'pipelines' ? null : tab;
    const isSelected = (section ?? 'pipelines') === tab;
    return {
      key: tab,
      label: t(`pipeline.sections.${tab}`),
      // the open tab keeps its own address, including the level of a system stage
      href: formatRoute({
        view: 'pipelines',
        run: isSelected ? selected : target,
        group: nextSection,
        step: isSelected && level !== null ? 'global' : null,
        tab: null,
      }),
      selected: isSelected,
      disabled: tab === 'actions' && !view,
      onClick: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        if (!isSelected) void go(target, nextSection);
      },
    };
  });
  const reload = useCallback(async () => {
    await load();
  }, [load]);
  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadStages()]);
  }, [load, loadStages]);
  const levelTag = (level: 'project' | 'global' | 'project_over_global') =>
    t(`settings.editor.levels.${LEVEL_KEYS[level]}`);
  const shown = applyPipelineFilter(view?.pipelines ?? [], filter, search);
  const count = activePipelineFilterCount(filter, search);
  const filtersPanel = view ? (
    <PipelineFilters
      filter={filter}
      options={options}
      search={search}
      onFilter={setFilter}
      onSearch={setSearch}
    />
  ) : null;
  const filterButton = (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <ListFilter />
      {count > 0 ? t('pipelines.filters.buttonCount', { count }) : t('pipelines.filters.button')}
    </Button>
  );
  const filtersControl =
    !view || columns || section !== null ? null : wide ? (
      <Popover>
        <PopoverTrigger asChild>{filterButton}</PopoverTrigger>
        <PopoverContent className="w-80 p-3">{filtersPanel}</PopoverContent>
      </Popover>
    ) : (
      <Sheet>
        <SheetTrigger asChild>{filterButton}</SheetTrigger>
        <SheetContent>
          <SheetTitle>{t('pipelines.filters.button')}</SheetTitle>
          <SheetDescription className="sr-only">{t('pipelines.filters.button')}</SheetDescription>
          <div className="p-3">{filtersPanel}</div>
        </SheetContent>
      </Sheet>
    );
  const activeRuns = (id: string) =>
    runs.filter((run) => run.pipeline === id && !run.finished).length;
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  return (
    <>
      <div className="px-4 pt-3">
        <LinkTabs label={t('pipeline.tabs')} tabs={tabs} />
      </div>
      <SplitPage
        filters={columns && section === null ? filtersPanel : null}
        filtersLabel={t('pipelines.filters.button')}
        side={
          <>
            {failure ? <Alert variant="destructive">{failure}</Alert> : null}
            {view ? <ConfigErrors errors={view.errors} /> : null}
            {section === null ? (
              <>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void go(NEW_ID)}>
                    <Plus />
                    {t('pipelines.new')}
                  </Button>
                  <Button variant="outline" disabled={!view} onClick={() => setImporting(true)}>
                    <Download />
                    {t('pipelines.import.open')}
                  </Button>
                </div>
                {filtersControl}
                {view && shown.length === 0 && count > 0 ? (
                  <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                    <p>{t('pipelines.filters.nothing')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFilter(EMPTY_PIPELINE_FILTER);
                        setSearch('');
                      }}
                    >
                      {t('pipelines.filters.reset')}
                    </Button>
                  </div>
                ) : null}
                <EntryList
                  label="pipeline"
                  selected={section === null ? selected : null}
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
            ) : null}
            {section === 'actions' ? (
              <>
                <Button
                  variant="outline"
                  disabled={!view}
                  onClick={() => void go(NEW_ID, 'actions')}
                >
                  <Plus />
                  {t('pipeline.actions.new')}
                </Button>
                <EntryList
                  label={t('pipeline.sections.actions')}
                  selected={section === 'actions' ? selected : null}
                  onSelect={(id) => void go(id, 'actions')}
                  entries={actions.map((entry) => ({
                    id: entry.id,
                    title:
                      typeof entry.raw.name === 'string' && entry.raw.name !== ''
                        ? entry.raw.name
                        : entry.id,
                    hint: entry.id,
                    tag: levelTag(entry.level),
                    subtitle: entry.id,
                  }))}
                />
              </>
            ) : null}
            {section === 'system' ? (
              <EntryList
                label={t('pipeline.sections.system')}
                selected={section === 'system' ? selected : null}
                onSelect={(id) => void go(id, 'system', level)}
                entries={SYSTEM_KINDS.map((kind) => ({
                  id: kind,
                  title: t(`pipeline.system.kinds.${kind}`),
                  hint: kind,
                  tag: levelTag(
                    stageLevel(stages?.stages.find((candidate) => candidate.kind === kind)),
                  ),
                }))}
              />
            ) : null}
          </>
        }
      >
        {!view ? (
          failure ? null : (
            <div role="status" aria-label={t('settings.editor.loading')}>
              <Skeleton className="h-40" />
            </div>
          )
        ) : section === 'system' ? (
          isSystemKind(selected) ? (
            <SystemStagePage
              key={selected}
              api={api}
              kind={selected}
              view={view}
              stages={stages}
              failure={stagesFailure}
              scope={level === 'global' ? 'global' : 'project'}
              onScope={(next) => void go(selected, 'system', next === 'global' ? 'global' : null)}
              onDirty={onDirty}
              onReload={reloadAll}
            />
          ) : (
            <Empty icon={<GitBranch />} title={t('pipeline.system.empty')} />
          )
        ) : section === 'actions' ? (
          selected === NEW_ID || action ? (
            <ActionForm
              key={
                action
                  ? `${action.id}:${action.level}:${action.sources.project?.revision ?? ''}:${action.sources.global?.revision ?? ''}`
                  : 'new'
              }
              api={api}
              view={view}
              action={action}
              notice={notice}
              onDirty={onDirty}
              onReload={reload}
              onSaved={async (id) => {
                dirty.current = false;
                await load();
                setNotice(t('pipeline.actions.saved'));
                notifySuccess(t('pipeline.actions.savedToast'));
                if (id !== selected) onSelect(id, 'actions');
              }}
              onDeleted={async () => {
                dirty.current = false;
                setNotice(null);
                const fresh = await load();
                notifySuccess(t('pipeline.actions.deletedToast', { id: selected ?? '' }));
                // a failed reload says nothing about the actions: keep the address
                if (!fresh) return;
                const left = actionsOf(fresh);
                // the other level's copy may remain: stay on it, the form is rebuilt by its key
                if (left.some((entry) => entry.id === selected)) return;
                // the address of an empty tab does not exist: open the first action left, else the new one
                lastOpen.current.actions = undefined;
                onSelect(left[0]?.id ?? NEW_ID, 'actions');
              }}
            />
          ) : (
            <Empty icon={<GitBranch />} title={t('pipeline.actions.empty')} />
          )
        ) : selected === NEW_ID ? (
          <PipelineForm
            key="new"
            api={api}
            view={view}
            pipeline={null}
            activeRuns={0}
            notice={null}
            onDirty={onDirty}
            onReload={reload}
            onSaved={async (id) => {
              dirty.current = false;
              await load();
              setNotice(t('pipelines.saved'));
              notifySuccess(t('pipelines.savedToast'));
              onSelect(id);
            }}
            onDeleted={async () => undefined}
          />
        ) : pipeline ? (
          <PipelineForm
            key={`${pipeline.id}:${pipeline.level}:${pipeline.sources.project?.revision ?? ''}:${pipeline.sources.global?.revision ?? ''}`}
            api={api}
            view={view}
            pipeline={pipeline}
            activeRuns={activeRuns(pipeline.id)}
            notice={notice}
            onDirty={onDirty}
            onReload={reload}
            onSaved={async (id) => {
              dirty.current = false;
              await load();
              setNotice(t('pipelines.saved'));
              notifySuccess(t('pipelines.savedToast'));
              if (id !== selected) onSelect(id);
            }}
            onDeleted={async () => {
              dirty.current = false;
              setNotice(null);
              await load();
              notifySuccess(t('pipelines.deletedToast', { id: selected ?? '' }));
            }}
          />
        ) : (
          <Empty icon={<GitBranch />} title={t('pipelines.empty')} />
        )}
        {view && repository ? (
          <PipelineImportDialog
            api={api}
            repository={repository}
            pipelines={view.pipelines}
            open={importing}
            onOpenChange={setImporting}
            onImported={async (ids) => {
              await load();
              notifySuccess(t('pipelines.import.done', { total: ids.length }));
            }}
          />
        ) : null}
      </SplitPage>
    </>
  );
}
