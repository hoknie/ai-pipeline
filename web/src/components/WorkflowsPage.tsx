import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { Download, GitBranch, ListFilter, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useConfirm } from '../confirm.tsx';
import { useMediaQuery } from '../media.ts';
import { notifySuccess } from '../notify.ts';
import { usePreference } from '../preferences.ts';
import { tagsOfSpecialist } from '../specialistTags.ts';
import {
  EMPTY_WORKFLOW_FILTER,
  activeWorkflowFilterCount,
  applyWorkflowFilter,
  existingWorkflowFilter,
  savedWorkflowFilter,
  workflowFilterOptions,
  type WorkflowFilter,
} from '../workflowFilters.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet.tsx';
import { Skeleton } from '../ui/skeleton.tsx';
import type { Api } from '../api.ts';
import type { ConfigEditorResponse, RunView } from '../types.ts';

import { ConfigErrors, EntryList, SplitPage } from './EntryList.tsx';
import { LEVEL_KEYS, NEW_ID } from './SpecialistsPage.tsx';
import { SpecialistTagChip } from './SpecialistTagChip.tsx';
import { WorkflowFilters } from './WorkflowFilters.tsx';
import { WorkflowForm } from './WorkflowForm.tsx';
import { WorkflowImportDialog } from './WorkflowImportDialog.tsx';
import { rawName } from './workflowName.ts';

export default function WorkflowsPage({
  api,
  runs,
  selected,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  runs: RunView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
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
  // the filters are kept per repository
  const [savedByRepository, setSavedByRepository] = usePreference<Record<string, unknown>>(
    'workflowFilters',
    {},
  );
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const [search, setSearch] = useState('');
  const repository = view?.repository ?? null;
  const options = useMemo(() => workflowFilterOptions(view?.workflows ?? []), [view]);
  const stored = useMemo<WorkflowFilter>(
    () =>
      repository === null
        ? EMPTY_WORKFLOW_FILTER
        : savedWorkflowFilter(savedByRepository[repository]),
    [savedByRepository, repository],
  );
  const filter = useMemo(() => existingWorkflowFilter(stored, options), [stored, options]);
  const setFilter = (next: WorkflowFilter) => {
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
      setView(await api.config());
      setFailure(null);
    } catch (error) {
      setFailure((error as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = async (id: string | null) => {
    if (id === selected) return;
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
    onSelect(id);
  };

  const workflow = view?.workflows.find((candidate) => candidate.id === selected) ?? null;
  const shown = applyWorkflowFilter(view?.workflows ?? [], filter, search);
  const count = activeWorkflowFilterCount(filter, search);
  const filtersPanel = view ? (
    <WorkflowFilters
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
      {count > 0 ? t('workflows.filters.buttonCount', { count }) : t('workflows.filters.button')}
    </Button>
  );
  const filtersControl =
    !view || columns ? null : wide ? (
      <Popover>
        <PopoverTrigger asChild>{filterButton}</PopoverTrigger>
        <PopoverContent className="w-80 p-3">{filtersPanel}</PopoverContent>
      </Popover>
    ) : (
      <Sheet>
        <SheetTrigger asChild>{filterButton}</SheetTrigger>
        <SheetContent>
          <SheetTitle>{t('workflows.filters.button')}</SheetTitle>
          <SheetDescription className="sr-only">{t('workflows.filters.button')}</SheetDescription>
          <div className="p-3">{filtersPanel}</div>
        </SheetContent>
      </Sheet>
    );
  const activeRuns = (id: string) =>
    runs.filter((run) => run.workflow === id && !run.finished).length;
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  return (
    <SplitPage
      filters={columns ? filtersPanel : null}
      filtersLabel={t('workflows.filters.button')}
      side={
        <>
          {failure ? <Alert variant="destructive">{failure}</Alert> : null}
          {view ? <ConfigErrors errors={view.errors} /> : null}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void go(NEW_ID)}>
              <Plus />
              {t('workflows.new')}
            </Button>
            <Button variant="outline" disabled={!view} onClick={() => setImporting(true)}>
              <Download />
              {t('workflows.import.open')}
            </Button>
          </div>
          {filtersControl}
          {view && shown.length === 0 && count > 0 ? (
            <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
              <p>{t('workflows.filters.nothing')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilter(EMPTY_WORKFLOW_FILTER);
                  setSearch('');
                }}
              >
                {t('workflows.filters.reset')}
              </Button>
            </div>
          ) : null}
          <EntryList
            label="pipeline"
            selected={selected}
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
                        hint={t('workflows.tagsSharedHint')}
                      />
                    ))}
                  </span>
                ) : undefined,
            }))}
          />
        </>
      }
    >
      {!view ? (
        failure ? null : (
          <div role="status" aria-label={t('settings.editor.loading')}>
            <Skeleton className="h-40" />
          </div>
        )
      ) : selected === NEW_ID ? (
        <WorkflowForm
          key="new"
          api={api}
          view={view}
          workflow={null}
          activeRuns={0}
          notice={null}
          onDirty={onDirty}
          onReload={load}
          onSaved={async (id) => {
            dirty.current = false;
            await load();
            setNotice(t('workflows.saved'));
            notifySuccess(t('workflows.savedToast'));
            onSelect(id);
          }}
          onDeleted={async () => undefined}
        />
      ) : workflow ? (
        <WorkflowForm
          key={`${workflow.id}:${workflow.level}:${workflow.sources.project?.revision ?? ''}:${workflow.sources.global?.revision ?? ''}`}
          api={api}
          view={view}
          workflow={workflow}
          activeRuns={activeRuns(workflow.id)}
          notice={notice}
          onDirty={onDirty}
          onReload={load}
          onSaved={async (id) => {
            dirty.current = false;
            await load();
            setNotice(t('workflows.saved'));
            notifySuccess(t('workflows.savedToast'));
            if (id !== selected) onSelect(id);
          }}
          onDeleted={async () => {
            dirty.current = false;
            setNotice(null);
            await load();
            notifySuccess(t('workflows.deletedToast', { id: selected ?? '' }));
          }}
        />
      ) : (
        <Empty icon={<GitBranch />} title={t('workflows.empty')} />
      )}
      {view && repository ? (
        <WorkflowImportDialog
          api={api}
          repository={repository}
          workflows={view.workflows}
          open={importing}
          onOpenChange={setImporting}
          onImported={async (ids) => {
            await load();
            notifySuccess(t('workflows.import.done', { total: ids.length }));
          }}
        />
      ) : null}
    </SplitPage>
  );
}
