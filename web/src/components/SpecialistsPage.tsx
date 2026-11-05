import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { Download, Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useConfirm } from '../confirm.tsx';
import { notifySuccess } from '../notify.ts';
import { usePreference } from '../preferences.ts';
import {
  EMPTY_FILTER,
  LIST_FIELDS,
  activeFilterCount,
  applyFilter,
  existingFilter,
  filterOptions,
  type SpecialistFilter,
} from '../specialistFilters.ts';
import { tagsOfSpecialist } from '../specialistTags.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';
import { Skeleton } from '../ui/skeleton.tsx';
import type { Api } from '../api.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
  EntryLevel,
} from '../types.ts';

import { ConfigErrors, EntryList, SplitPage } from './EntryList.tsx';
import { SpecialistForm } from './SpecialistForm.tsx';
import { SpecialistImportDialog } from './SpecialistImportDialog.tsx';
import { SpecialistTagChip } from './SpecialistTagChip.tsx';
import { SpecialistFilters } from './SpecialistFilters.tsx';

export const NEW_ID = 'new';

/** Key of the label of a level in the dictionaries, under `settings.editor.levels`. */
export const LEVEL_KEYS: Record<EntryLevel, EntryLevel> = {
  project: 'project',
  global: 'global',
  project_over_global: 'project_over_global',
};

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Only well-formed parts of a saved choice are used. */
function savedOthers(saved: unknown): Partial<Omit<SpecialistFilter, 'tags'>> {
  if (typeof saved !== 'object' || saved === null) return {};
  const record = saved as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of LIST_FIELDS) if (isStrings(record[field])) result[field] = record[field];
  if (record.level === 'all' || record.level === 'project' || record.level === 'global') {
    result.level = record.level;
  }
  return result;
}

export default function SpecialistsPage({
  api,
  selected,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Whether the open form has unsaved edits; the caller owns it to guard other navigation. */
  dirty?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ConfigEditorResponse | null>(null);
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirm();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const [importing, setImporting] = useState(false);
  // the chosen tags are kept per repository
  const [chosenByRepository, setChosenByRepository] = usePreference<Record<string, string[]>>(
    'specialistTags',
    {},
  );
  // the other filters are kept per repository too
  const [othersByRepository, setOthersByRepository] = usePreference<
    Record<string, Partial<Omit<SpecialistFilter, 'tags'>>>
  >('specialistFilters', {});
  const [filtersOpen, setFiltersOpen] = usePreference('specialistFiltersOpen', false);
  const [search, setSearch] = useState('');
  const repository = view?.repository ?? null;
  const options = useMemo(() => filterOptions(view?.specialists ?? []), [view]);
  const stored = useMemo<SpecialistFilter>(
    () =>
      repository === null
        ? EMPTY_FILTER
        : {
            ...EMPTY_FILTER,
            ...savedOthers(othersByRepository[repository]),
            tags: chosenByRepository[repository] ?? [],
          },
    [chosenByRepository, othersByRepository, repository],
  );
  const filter = useMemo(() => existingFilter(stored, options), [stored, options]);
  const setFilter = (next: SpecialistFilter) => {
    if (repository === null) return;
    const { tags, ...others } = next;
    setChosenByRepository({ ...chosenByRepository, [repository]: tags });
    setOthersByRepository({ ...othersByRepository, [repository]: others });
  };
  // a value nobody has any more drops out of the saved choice
  useEffect(() => {
    if (view && repository !== null && JSON.stringify(filter) !== JSON.stringify(stored)) {
      const { tags, ...others } = filter;
      setChosenByRepository({ ...chosenByRepository, [repository]: tags });
      setOthersByRepository({ ...othersByRepository, [repository]: others });
    }
  }, [
    view,
    repository,
    filter,
    stored,
    chosenByRepository,
    othersByRepository,
    setChosenByRepository,
    setOthersByRepository,
  ]);

  const load = useCallback(async () => {
    // The catalog only helps the form: its failure leaves the lists free to type in.
    const loading = api.catalog().then(
      (value) => ({ value, message: null }),
      (error: Error) => ({ value: null, message: error.message }),
    );
    try {
      setView(await api.config());
      setFailure(null);
    } catch (error) {
      setFailure((error as Error).message);
    }
    const result = await loading;
    setCatalog(result.value);
    setCatalogError(result.message);
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

  const specialist = view?.specialists.find((candidate) => candidate.slug === selected) ?? null;
  const shown = applyFilter(view?.specialists ?? [], filter, search);
  const narrowed = activeFilterCount(filter) > 0 || search.trim() !== '';

  return (
    <SplitPage
      side={
        <>
          {failure ? <Alert variant="destructive">{failure}</Alert> : null}
          {view ? <ConfigErrors errors={view.errors} /> : null}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void go(NEW_ID)}>
              <Plus />
              {t('specialists.new')}
            </Button>
            <Button variant="outline" disabled={!view} onClick={() => setImporting(true)}>
              <Download />
              {t('specialists.import.open')}
            </Button>
          </div>
          {view ? (
            <SpecialistFilters
              filter={filter}
              options={options}
              search={search}
              open={filtersOpen}
              onFilter={setFilter}
              onSearch={setSearch}
              onOpen={setFiltersOpen}
            />
          ) : null}
          {view && shown.length === 0 && narrowed ? (
            <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
              <p>{t('specialists.filters.nothing')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilter(EMPTY_FILTER);
                  setSearch('');
                }}
              >
                {t('specialists.filters.reset')}
              </Button>
            </div>
          ) : null}
          <EntryList
            label={t('specialists.list')}
            selected={selected}
            onSelect={(id) => void go(id)}
            entries={shown.map((entry) => ({
              id: entry.slug,
              title: entry.effective?.name ?? entry.raw.name?.toString() ?? entry.slug,
              subtitle: [
                entry.slug,
                entry.effective
                  ? `${entry.effective.runtime}${entry.effective.model ? ` · ${entry.effective.model}` : ''}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
              tag: t(`settings.editor.levels.${LEVEL_KEYS[entry.level]}`),
              extra:
                tagsOfSpecialist(entry).length > 0 ? (
                  <span data-testid={`tags-${entry.slug}`} className="flex flex-wrap gap-1">
                    {tagsOfSpecialist(entry).map((tag) => (
                      <SpecialistTagChip key={tag.name} name={tag.name} shared={tag.shared} />
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
        <SpecialistForm
          key="new"
          api={api}
          view={view}
          specialist={null}
          catalog={catalog}
          catalogError={catalogError}
          notice={null}
          onDirty={(value) => (dirty.current = value)}
          onReload={load}
          onSaved={async (slug) => {
            dirty.current = false;
            await load();
            setNotice(t('specialists.saved'));
            notifySuccess(t('specialists.savedToast'));
            onSelect(slug);
          }}
          onDeleted={async () => undefined}
        />
      ) : specialist ? (
        <SpecialistForm
          key={`${specialist.slug}:${specialist.level}:${specialist.sources.project?.revision ?? ''}:${specialist.sources.global?.revision ?? ''}`}
          api={api}
          view={view}
          specialist={specialist as EditorSpecialist}
          catalog={catalog}
          catalogError={catalogError}
          notice={notice}
          onDirty={(value) => (dirty.current = value)}
          onReload={load}
          onSaved={async (slug) => {
            dirty.current = false;
            await load();
            setNotice(t('specialists.saved'));
            notifySuccess(t('specialists.savedToast'));
            if (slug !== selected) onSelect(slug);
          }}
          onDeleted={async () => {
            dirty.current = false;
            setNotice(null);
            await load();
            notifySuccess(t('specialists.deletedToast', { id: selected ?? '' }));
          }}
        />
      ) : (
        <Empty icon={<Users />} title={t('specialists.empty')} />
      )}
      {view && repository ? (
        <SpecialistImportDialog
          api={api}
          repository={repository}
          specialists={view.specialists}
          open={importing}
          onOpenChange={setImporting}
          onImported={async (slugs) => {
            await load();
            notifySuccess(t('specialists.import.done', { total: slugs.length }));
          }}
        />
      ) : null}
    </SplitPage>
  );
}
