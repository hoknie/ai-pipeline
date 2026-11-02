import { ArrowLeft, Inbox, MousePointerClick } from 'lucide-react';
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
import { Skeleton } from '../../ui/skeleton.tsx';
import { needsAttention, orderGroups } from '../order.ts';

import { GroupScreen } from './GroupScreen.tsx';
import { RunHeader } from './RunHeader.tsx';
import { RunList } from './RunList.tsx';
import { filterRuns, type RunFilter, type RunScope } from './runFilter.ts';

/** The runs section: the list of runs on the left, the open run and its group on the right. */
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

  const list = loaded ? (
    runs.length === 0 ? null : (
      <RunList
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
      <div className="p-3">{list}</div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-80 shrink-0 overflow-y-auto border-r p-3">{list}</aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{detail}</main>
    </div>
  );
}
