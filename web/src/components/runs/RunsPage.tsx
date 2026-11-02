import { ArrowLeft, Inbox, ListFilter, MousePointerClick } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { modLabel, useHotkey } from '../../hotkeys.ts';
import { useMediaQuery } from '../../media.ts';
import { usePreference } from '../../preferences.ts';
import { useTags } from '../../tags.tsx';
import type { Route } from '../../route.ts';
import type { RunView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Kbd } from '../../ui/kbd.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.tsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../ui/sheet.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { needsAttention, orderGroups } from '../order.ts';

import { GroupScreen } from './GroupScreen.tsx';
import { RunHeader } from './RunHeader.tsx';
import { RunFilters } from './RunFilters.tsx';
import { RunList } from './RunList.tsx';
import { activeFilters, filterRuns, type RunFilter, type RunScope } from './runFilter.ts';

/** The runs section: filters, the list of runs and the open run with its group; filters sit in a column from 1280 px and behind a button below. */
export function RunsPage({
  api,
  runs,
  loaded,
  route,
  now,
  drafts,
  onDraft,
  onClearDrafts,
  onError,
  onlyReplies,
  onOnlyReplies,
  onRoute,
  repository,
  scope,
  onScope,
}: {
  api: Api;
  runs: RunView[];
  loaded: boolean;
  route: Route;
  now: number;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onError: (message: string) => void;
  onlyReplies: boolean;
  onOnlyReplies: (value: boolean) => void;
  onRoute: (route: Route) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  scope: RunScope;
  onScope: (scope: RunScope) => void;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = usePreference<RunFilter>('runFilter', 'all');
  const { byId } = useTags();
  const [storedTags, setStoredTags] = usePreference<string[]>('runTags', []);
  // an id that is not in the catalog (the tag was removed) drops out of the selection
  const tagIds = storedTags.filter((id) => byId.has(id));
  const [screen, setScreen] = useState<'list' | 'detail'>(route.group ? 'detail' : 'list');

  const run = runs.find((candidate) => candidate.id === route.run) ?? null;
  const ordered = run ? orderGroups(run.groups) : [];
  const group =
    ordered.find((candidate) => candidate.slug === route.group) ??
    ordered.find(needsAttention) ??
    ordered[0] ??
    null;

  const select = (runId: string, slug: string | null) => {
    setScreen('detail');
    onRoute({ view: 'runs', run: runId, group: slug, step: null });
  };

  const shown = filterRuns(
    runs,
    query,
    filter,
    scope === 'repository' ? repository : null,
    tagIds,
    byId,
  );
  const step = (delta: number) => {
    if (shown.length === 0) return;
    const at = shown.findIndex((candidate) => candidate.id === run?.id);
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + delta))];
    if (!next) return;
    select(next.id, null);
    document
      .querySelector(`[data-run="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  useHotkey('j', () => step(1));
  useHotkey('k', () => step(-1));

  // A jump to another run or group from outside the list (address, palette, topology) opens the
  // run screen; the first automatic choice of a run (null → run) keeps the list.
  const seen = useRef({ run: route.run, group: route.group, step: route.step });
  useEffect(() => {
    const before = seen.current;
    seen.current = { run: route.run, group: route.group, step: route.step };
    const moved =
      (before.run !== null && route.run !== before.run) ||
      (route.group !== null && (route.group !== before.group || route.step !== before.step));
    if (moved && route.run) setScreen('detail');
  }, [route.run, route.group, route.step]);

  useEffect(() => {
    if (wide) setScreen('list');
  }, [wide]);

  const filterProps = {
    runs,
    query,
    onQuery: setQuery,
    filter,
    onFilter: setFilter,
    scope,
    onScope,
    repository,
    tagIds,
    onTagIds: setStoredTags,
  };
  const count = activeFilters(query, filter, tagIds);
  const filterButton = (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <ListFilter />
      {count > 0 ? t('runs.list.filtersCount', { count }) : t('runs.list.filters')}
    </Button>
  );
  const filtersControl = columns ? null : wide ? (
    <Popover>
      <PopoverTrigger asChild>{filterButton}</PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <RunFilters {...filterProps} />
      </PopoverContent>
    </Popover>
  ) : (
    <Sheet>
      <SheetTrigger asChild>{filterButton}</SheetTrigger>
      <SheetContent>
        <SheetTitle>{t('runs.list.filters')}</SheetTitle>
        <SheetDescription className="sr-only">{t('runs.list.filters')}</SheetDescription>
        <div className="p-3">
          <RunFilters {...filterProps} />
        </div>
      </SheetContent>
    </Sheet>
  );

  const list = loaded ? (
    runs.length === 0 ? null : (
      <RunList
        filters={false}
        runs={runs}
        selectedRun={run?.id ?? null}
        selectedGroup={group?.slug ?? null}
        now={now}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        onSelect={select}
        scope={scope}
        onScope={onScope}
        repository={repository}
        tagIds={tagIds}
        onTagIds={setStoredTags}
      />
    )
  ) : (
    <div role="status" aria-label={t('runs.page.connecting')} className="flex flex-col gap-2">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );

  if (loaded && runs.length === 0) {
    return (
      <Empty icon={<Inbox />} title={t('runs.page.noRuns')} className="m-auto">
        <p>
          {t('runs.page.startWith')}{' '}
          <code className="font-mono">aip run start feature --task "…"</code>.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a
            href="#queue"
            onClick={(event) => {
              event.preventDefault();
              onRoute({ view: 'queue', run: null, group: null, step: null });
            }}
          >
            {t('runs.page.openQueue')}
          </a>
        </Button>
      </Empty>
    );
  }

  const detail = run ? (
    <>
      <RunHeader run={run} api={api} now={now} onError={onError} />
      {group ? (
        <GroupScreen
          key={`${run.id}/${group.slug}/${route.step ?? ''}`}
          api={api}
          runId={run.id}
          row={group}
          openStep={route.group === group.slug ? route.step : null}
          draftKey={`${run.id}/${group.slug}`}
          drafts={drafts}
          onDraft={onDraft}
          onClearDrafts={onClearDrafts}
          onError={onError}
          onlyReplies={onlyReplies}
          onOnlyReplies={onOnlyReplies}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t('runs.page.noGroups')}</p>
      )}
    </>
  ) : loaded ? (
    <Empty icon={<MousePointerClick />} title={t('runs.page.choose')} className="m-auto">
      <p>
        {t('runs.page.chooseHint')} <Kbd>{modLabel()}K</Kbd>
      </p>
    </Empty>
  ) : null;

  if (!wide) {
    return screen === 'detail' && run ? (
      <div className="flex min-w-0 flex-col">
        <Button variant="ghost" size="sm" className="m-2 w-fit" onClick={() => setScreen('list')}>
          <ArrowLeft />
          {t('runs.page.back')}
        </Button>
        {detail}
      </div>
    ) : (
      <div className="flex flex-col gap-2 p-3">
        {loaded ? filtersControl : null}
        {list}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      {columns && loaded ? (
        <aside
          aria-label={t('runs.list.filters')}
          className="w-64 shrink-0 overflow-y-auto border-r p-3"
        >
          <RunFilters {...filterProps} />
        </aside>
      ) : null}
      <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3">
        {loaded ? filtersControl : null}
        {list}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{detail}</main>
    </div>
  );
}
