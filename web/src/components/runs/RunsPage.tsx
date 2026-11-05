import {
  ArrowLeft,
  Inbox,
  ListFilter,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
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
import { defaultEntry, orderEntries } from '../order.ts';

import { useOutOfView } from '../../useOutOfView.ts';
import { GroupScreen } from './GroupScreen.tsx';
import { canDeliver } from './delivery.ts';
import { useDeliveryOutcome } from './useDeliveryOutcome.ts';
import { RunHeader } from './RunHeader.tsx';
import { RunFilters } from './RunFilters.tsx';
import type { OpenedState } from '../../store.ts';
import { RunList } from './RunList.tsx';
import type { HistoryState } from '../../store.ts';
import {
  activeFilters,
  EMPTY_FILTERS,
  filterRuns,
  type RunFilterState,
  type RunScope,
} from './runFilter.ts';

/** Widths (px) of the columns: the filters, their collapsed strip and the list of runs. */
const FILTERS_WIDTH = 256;
const STRIP_WIDTH = 40;
const LIST_WIDTH = 320;
/** Collapsing frees FILTERS_WIDTH − STRIP_WIDTH px: 2/3 of it goes to the list, 1/3 to the run. */
const LIST_WIDTH_COLLAPSED = LIST_WIDTH + Math.round(((FILTERS_WIDTH - STRIP_WIDTH) * 2) / 3);

/** The tags chosen before the filters were stored together, so that the choice survives. */
function legacyTags(): string[] {
  try {
    const raw = window.localStorage.getItem('aip.web.runTags');
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** The runs section: filters, the list of runs and the open run with its group; filters sit in a column from 1280 px and behind a button below. */
function moreOf(history: HistoryState | undefined): 'idle' | 'loading' | 'error' | 'done' {
  if (!history || history.done) return 'done';
  return history.error !== null ? 'error' : history.loading ? 'loading' : 'idle';
}

export function RunsPage({
  api,
  runs,
  loaded,
  openedState = null,
  route,
  now,
  drafts,
  onDraft,
  onClearDrafts,
  onError,
  onlyReplies,
  onOnlyReplies,
  showJson,
  onShowJson,
  onRoute,
  repository,
  repositoryPaths,
  scope,
  onScope,
  onSubtask,
  history,
}: {
  api: Api;
  runs: RunView[];
  loaded: boolean;
  /** Whether the run of the address is listed, being fetched by id, or unknown to the daemon. */
  openedState?: OpenedState;
  route: Route;
  now: number;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onError: (message: string) => void;
  onlyReplies: boolean;
  onOnlyReplies: (value: boolean) => void;
  showJson: boolean;
  onShowJson: (value: boolean) => void;
  onRoute: (route: Route) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  /** The path of each repository as shown; absent: the path itself. */
  repositoryPaths?: ReadonlyMap<string, string>;
  scope: RunScope;
  /** Opens a new task as a child of the run; absent while the queue is unknown. */
  onSubtask?: (run: RunView) => void;
  /** Loading of older finished runs; without it the list is all there is. */
  history?: HistoryState;
  onScope: (scope: RunScope) => void;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const [query, setQuery] = useState('');
  const [headerElement, setHeaderElement] = useState<HTMLElement | null>(null);
  const headerOut = useOutOfView(headerElement);
  const { byId } = useTags();
  const [legacy] = useState(legacyTags);
  const [stored, setStored] = usePreference<RunFilterState>('runFilters', {
    ...EMPTY_FILTERS,
    tagIds: legacy,
  });
  const [collapsed, setCollapsed] = usePreference<boolean>('runFiltersCollapsed', false);
  // an id that is not in the catalog of the selected repository (the tag was removed, or the
  // repository changed) drops out of the selection
  const filters: RunFilterState = {
    ...EMPTY_FILTERS,
    ...stored,
    tagIds: (stored.tagIds ?? []).filter((id) => byId.get(id)?.repository === repository),
  };
  const [screen, setScreen] = useState<'list' | 'detail'>(route.group ? 'detail' : 'list');

  const deliver = useDeliveryOutcome(api, runs);
  const run = runs.find((candidate) => candidate.id === route.run) ?? null;
  const ordered = run ? orderEntries(run) : [];
  const group =
    ordered.find((candidate) => candidate.slug === route.group) ?? (run ? defaultEntry(run) : null);

  const select = (runId: string, slug: string | null) => {
    setScreen('detail');
    onRoute({ view: 'runs', run: runId, group: slug, step: null, tab: null });
  };

  const shown = filterRuns(runs, query, filters, scope, repository, byId);
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
    filters,
    onFilters: setStored,
    scope,
    onScope,
    repository,
    repositoryPaths,
  };
  const count = activeFilters(query, filters, scope);
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
        showFilters={false}
        runs={runs}
        selectedRun={run?.id ?? null}
        selectedGroup={group?.slug ?? null}
        now={now}
        query={query}
        onQuery={setQuery}
        filters={filters}
        onFilters={setStored}
        onSelect={select}
        scope={scope}
        onScope={onScope}
        repository={repository}
        repositoryPaths={repositoryPaths}
        more={moreOf(history)}
        onMore={history?.loadMore}
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
              onRoute({ view: 'queue', run: null, group: null, step: null, tab: null });
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
      <RunHeader
        run={run}
        api={api}
        now={now}
        onError={onError}
        onDeliver={(force) => deliver(run, force)}
        onSubtask={onSubtask}
        onSelect={(slug) => select(run.id, slug)}
        headerRef={setHeaderElement}
        entry={group}
      />
      {group ? (
        <GroupScreen
          key={`${run.id}/${group.slug}/${route.step ?? ''}`}
          api={api}
          runId={run.id}
          row={group}
          openStep={route.group === group.slug ? route.step : null}
          tab={route.group === null || route.group === group.slug ? route.tab : null}
          onTab={(tab) => onRoute({ ...route, group: group.slug, tab: tab === 'log' ? null : tab })}
          draftKey={`${run.id}/${group.slug}`}
          drafts={drafts}
          onDraft={onDraft}
          onClearDrafts={onClearDrafts}
          onError={onError}
          onlyReplies={onlyReplies}
          onOnlyReplies={onOnlyReplies}
          showJson={showJson}
          onShowJson={onShowJson}
          deliverable={canDeliver(run)}
          onDeliver={() => deliver(run, false)}
          run={run}
          onForceDeliver={() => deliver(run, true)}
          showUsage={headerOut}
          onSelectEntry={(slug) => select(run.id, slug)}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t('runs.page.noGroups')}</p>
      )}
    </>
  ) : openedState === 'loading' ? (
    <div role="status" aria-label={t('runs.page.connecting')} className="flex flex-col gap-2 p-4">
      <Skeleton className="h-16" />
      <Skeleton className="h-40" />
    </div>
  ) : openedState === 'missing' ? (
    <Empty icon={<Inbox />} title={t('runs.page.notFound')} className="m-auto">
      <p className="font-mono">{route.run}</p>
    </Empty>
  ) : loaded ? (
    <Empty icon={<MousePointerClick />} title={t('runs.page.choose')} className="m-auto">
      <p>
        {t('runs.page.chooseHint')} <Kbd>{modLabel()}K</Kbd>
      </p>
    </Empty>
  ) : null;

  if (!wide) {
    return screen === 'detail' &&
      (run || openedState === 'loading' || openedState === 'missing') ? (
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
        collapsed ? (
          <aside
            aria-label={t('runs.list.filters')}
            data-filters="collapsed"
            style={{ width: STRIP_WIDTH }}
            className="flex shrink-0 flex-col items-center gap-2 border-r py-3"
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('runs.list.expand')}
              title={t('runs.list.expand')}
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen />
            </Button>
            {count > 0 ? (
              <span
                aria-label={t('runs.list.filtersCount', { count })}
                className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
              >
                {count}
              </span>
            ) : null}
          </aside>
        ) : (
          <aside
            aria-label={t('runs.list.filters')}
            data-filters="expanded"
            style={{ width: FILTERS_WIDTH }}
            className="flex shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
          >
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              aria-label={t('runs.list.collapse')}
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose />
              {t('runs.list.collapse')}
            </Button>
            <RunFilters {...filterProps} />
          </aside>
        )
      ) : null}
      <aside
        data-runs-list
        style={{ width: columns && collapsed ? LIST_WIDTH_COLLAPSED : LIST_WIDTH }}
        className="flex shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
      >
        {loaded ? filtersControl : null}
        {list}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{detail}</main>
    </div>
  );
}
