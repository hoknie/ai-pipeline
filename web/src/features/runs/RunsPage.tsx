import { useState } from 'react';

import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { defaultEntry, orderEntries } from '../../shared/lib/order.ts';
import { activeFilters, filterRuns } from './list/runFilter.ts';
import { NarrowDetail } from './page/NarrowDetail.tsx';
import { RunFilterColumn, RunFiltersButton } from './page/RunFilterSlots.tsx';
import { NoRuns } from './page/NoRuns.tsx';
import { RunDetail } from './page/RunDetail.tsx';
import { RunListPane } from './page/RunListPane.tsx';
import type { RunsPageProps } from './page/types.ts';
import { useRunFilters } from './page/useRunFilters.ts';
import { useRunNavigation } from './page/useRunNavigation.ts';
import { LIST_WIDTH, LIST_WIDTH_COLLAPSED } from './page/widths.ts';

/** The runs section: filters, the list of runs and the open run with its group; filters sit in a column from 1280 px and behind a button below. */
export function RunsPage(props: RunsPageProps) {
  const { runs, loaded, openedState = null, route, repository, scope } = props;
  const wide = useMediaQuery('(min-width: 768px)');
  const columns = useMediaQuery('(min-width: 1280px)');
  const [query, setQuery] = useState('');
  const { filters, setStored, collapsed, setCollapsed, byId } = useRunFilters(repository);
  const run = runs.find((candidate) => candidate.id === route.run) ?? null;
  const shown = filterRuns(runs, query, filters, scope, repository, byId);
  const { screen, setScreen, select } = useRunNavigation({
    route,
    onRoute: props.onRoute,
    wide,
    shown,
    run,
  });
  const filterProps = {
    runs,
    query,
    onQuery: setQuery,
    filters,
    onFilters: setStored,
    scope,
    onScope: props.onScope,
    repository,
    repositoryPaths: props.repositoryPaths,
  };
  const count = activeFilters(query, filters, scope);
  if (loaded && runs.length === 0) return <NoRuns onRoute={props.onRoute} />;
  const group = run
    ? (orderEntries(run).find((candidate) => candidate.slug === route.group) ?? defaultEntry(run))
    : null;
  const detail = <RunDetail {...props} run={run} onSelect={select} />;
  const control = loaded ? (
    <RunFiltersButton filterProps={filterProps} count={count} wide={wide} />
  ) : null;
  const list = (
    <RunListPane
      {...filterProps}
      loaded={loaded}
      run={run}
      group={group?.slug ?? null}
      now={props.now}
      onSelect={select}
      history={props.history}
    />
  );
  if (!wide) {
    const open = run || openedState === 'loading' || openedState === 'missing';
    return screen === 'detail' && open ? (
      <NarrowDetail onBack={() => setScreen('list')}>{detail}</NarrowDetail>
    ) : (
      <div className="flex flex-col gap-2 p-3">
        {control}
        {list}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      {columns && loaded ? (
        <RunFilterColumn
          filterProps={filterProps}
          count={count}
          collapsed={collapsed}
          onCollapsed={setCollapsed}
        />
      ) : null}
      <aside
        data-runs-list
        style={{ width: columns && collapsed ? LIST_WIDTH_COLLAPSED : LIST_WIDTH }}
        className="flex shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
      >
        {columns ? null : control}
        {list}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{detail}</main>
    </div>
  );
}
