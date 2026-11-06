import { MoreHorizontal, RefreshCw, RotateCcw, SkipForward, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import {
  clock,
  cost,
  duration,
  reasonLabel,
  runTitle,
  taskNumber,
  usageText,
} from '../../format.ts';
import { notifySuccess } from '../../notify.ts';
import { useElementHeight } from '../../useElementHeight.ts';
import type { GroupRow, GroupView, RunView, SystemStepRow } from '../../types.ts';
import { Alert } from '../../ui/alert.tsx';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Label } from '../../ui/label.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { Switch } from '../../ui/switch.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs.tsx';
import { Markdown } from '../Markdown.tsx';
import { OutsideChanges } from '../OutsideChanges.tsx';
import { RunStatuses, entryBadge } from './RunStatuses.tsx';
import { StatusBadge } from '../StatusBadge.tsx';

import { ArtifactsTab } from './ArtifactsTab.tsx';
import { AttemptTimeline } from './AttemptTimeline.tsx';
import { FileTree } from './FileTree.tsx';
import { QuestionCard } from './QuestionCard.tsx';
import { DiffStat } from './DiffStat.tsx';
import { FilePath } from '../FilePath.tsx';
import { ApplyDialog } from './ApplyDialog.tsx';
import { MessageDialog } from './MessageDialog.tsx';
import { QuestionsForm } from './QuestionsForm.tsx';
import { stepOfGroup, useSkipStep } from './skipStep.tsx';
import { groupNotices, latestNotice, useDismissedNotice } from './groupNotices.ts';
import { taskProgress } from './taskProgress.ts';
import { useGroupSpec } from './useGroupSpec.ts';

type Tab = 'log' | 'changes' | 'task' | 'design' | 'tasks' | 'artifacts';

/** Lines of a delivery failure shown before «Show all». */
const REASON_LINES = 6;

/** What the screen of a group or a system step offers. */
function capabilities(row: GroupRow | SystemStepRow, deliverable: boolean, inProgress: boolean) {
  const system = 'kind' in row;
  const delivery = system && row.kind !== 'split';
  const stopped = row.status === 'failed' || row.status === 'cancelled';
  return {
    retry: !delivery && ['failed', 'cancelled', 'conflict'].includes(row.status),
    retryDelivery: delivery && stopped && (deliverable || inProgress),
    cancel: !['merged', 'done', 'failed', 'cancelled'].includes(row.status),
    changes: !system,
  };
}

export function GroupScreen({
  api,
  runId,
  row,
  openStep = null,
  draftKey,
  drafts,
  onDraft,
  onClearDrafts,
  onError,
  onlyReplies = false,
  onOnlyReplies,
  deliverable = false,
  onDeliver,
  run,
  onForceDeliver,
  showUsage = false,
  onSelectEntry,
  tab: addressTab = null,
  onTab: onAddressTab,
}: {
  /** Tab asked for by the address; null for the log. */
  tab?: string | null;
  onTab?: (tab: string) => void;
  /** Opens a group or a system step of the run (the resolver badge). */
  onSelectEntry?: (slug: string) => void;
  /** The run header is scrolled out of view: show the run title, statuses, duration, tokens and cost in the header. */
  showUsage?: boolean;
  api: Api;
  runId: string;
  row: GroupRow | SystemStepRow;
  /** Open the last attempt of this step instead of the last attempt of the group. */
  openStep?: string | null;
  /** Prefix of the keys of the drafts of this group: `<run>/<group>`. */
  draftKey: string;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onError: (message: string) => void;
  /** Show only the texts of the specialist in every log. */
  onlyReplies?: boolean;
  onOnlyReplies?: (value: boolean) => void;
  /** Whether delivery of the merged groups can be started now (for a failed delivery step). */
  deliverable?: boolean;
  onDeliver?: () => Promise<unknown>;
  /** The run of the group, for the `--force` delivery dialog. */
  run?: RunView;
  onForceDeliver?: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [view, setView] = useState<GroupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [messaging, setMessaging] = useState<number | null>(null);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const headerHeight = useElementHeight(header);
  // The statuses stay in the DOM while the header collapses, so the collapse is animated too.
  const [statusesMounted, setStatusesMounted] = useState(showUsage);
  useEffect(() => {
    if (showUsage) {
      setStatusesMounted(true);
      return;
    }
    const timer = setTimeout(() => setStatusesMounted(false), 250);
    return () => clearTimeout(timer);
  }, [showUsage]);
  const version = `${row.status}/${row.step}/${row.round}/${row.diff?.added ?? ''}/${row.diffRevision ?? ''}/${row.delivery}/${row.usage?.inputTokens ?? ''}/${row.usage?.outputTokens ?? ''}/${run?.delivery.inProgress ?? ''}/${run?.delivery.finishedAt ?? ''}/${row.artifacts}/${row.artifactsRevision}`;
  const delivering = run?.delivery.inProgress ?? false;
  const caps = capabilities(row, deliverable, delivering);
  const skipper = useSkipStep(run, api, onError);
  const skippable = run && !('kind' in row) ? stepOfGroup(run, row.slug) : null;
  const skipState = skippable ? run?.steps?.find((step) => step.id === skippable) : undefined;
  const canSkip = !!run && !!skipState && skipState.state !== 'done' && !skipState.skipped;
  // without a controlling parent the screen keeps its tab itself
  const [localTab, setLocalTab] = useState<string | null>(null);
  const requestedTab = onAddressTab ? addressTab : localTab;
  const onTab = onAddressTab ?? setLocalTab;
  const active = !['merged', 'done', 'failed', 'cancelled'].includes(row.status);
  const system = 'kind' in row;
  const spec = useGroupSpec(
    api,
    runId,
    row.slug,
    version,
    active && (requestedTab === 'design' || requestedTab === 'tasks'),
    onError,
    !system,
  );
  const available = new Set<string>(['log', 'task']);
  if (caps.changes) available.add('changes');
  if (spec?.design != null) available.add('design');
  if (spec?.tasks != null) available.add('tasks');
  if (row.artifacts > 0) available.add('artifacts');
  const loaded = view !== null && (system || spec !== undefined);
  const tab: Tab = (available.has(requestedTab ?? 'log') ? (requestedTab ?? 'log') : 'log') as Tab;
  const setTab = (next: string) => onTab(next);
  useEffect(() => {
    if (loaded && requestedTab !== null && !available.has(requestedTab)) onTab('log');
  });
  const progress = spec?.tasks != null ? taskProgress(spec.tasks) : null;
  const title = 'kind' in row ? t(`runs.system.${row.kind}`) : row.title;

  useEffect(() => {
    let stopped = false;
    api.group(runId, row.slug).then(
      (next) => !stopped && setView(next),
      (failure: Error) => !stopped && onError(failure.message),
    );
    return () => {
      stopped = true;
    };
  }, [api, runId, row.slug, version, onError]);

  const act = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await work();
      after?.();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lastSeq = view?.attempts.at(-1)?.seq ?? null;
  const openSeq =
    (openStep ? view?.attempts.findLast((attempt) => attempt.stepId === openStep)?.seq : null) ??
    lastSeq;
  const cancelGroup = async () => {
    const yes = await confirm({
      title: t('runs.group.cancelTitle', { title }),
      description: t('runs.group.cancelDescription'),
      confirmLabel: t('runs.group.cancelGroup'),
      cancelLabel: t('runs.header.keep'),
      destructive: true,
    });
    if (yes)
      await act(
        () => api.cancel(runId, row.slug),
        () => notifySuccess(t('runs.group.cancelled')),
      );
  };
  const markDelivered = async () => {
    if (!run) return;
    const yes = await confirm({
      title: t('runs.system.markDeliveredTitle', { title }),
      description: t('runs.header.markDeliveredConfirm'),
      confirmLabel: t('runs.header.markDeliveredAction'),
      cancelLabel: t('runs.header.markDeliveredKeep'),
    });
    if (yes)
      await act(
        () => api.markDelivered(run.id, [row.slug]),
        () => notifySuccess(t('runs.header.markedDelivered')),
      );
  };
  const [dismissed, dismiss] = useDismissedNotice(runId, row.slug);
  const notice = latestNotice(groupNotices(view, row as GroupRow), dismissed);
  const closeButton = notice ? (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-1 right-1 size-7"
      aria-label={t('runs.group.dismissNotice')}
      title={t('runs.group.dismissNotice')}
      onClick={() => dismiss(notice.key)}
    >
      <X />
    </Button>
  ) : null;
  const deliveryFailed =
    !('kind' in row) && row.status === 'merged' && row.delivery === 'apply_failed';
  const reason = view?.delivery.reason ?? null;
  const stage = run?.deliveryStage ?? null;
  const attemptAt = run?.delivery.finishedAt ?? null;

  const heading = (
    <h2 className="min-w-0 flex-1 truncate text-base font-semibold" title={run ? undefined : title}>
      {run ? (
        <span
          aria-hidden={showUsage ? undefined : true}
          title={`${runTitle(run)}\n${run.id}`}
          className={`block truncate transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
            showUsage ? 'translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0'
          }`}
        >
          <span className="font-mono font-normal text-muted-foreground">
            {taskNumber(run.number)}
          </span>{' '}
          {runTitle(run)}
        </span>
      ) : (
        title
      )}
    </h2>
  );
  const actions = (
    <>
      {onOnlyReplies ? (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Switch id="only-replies" checked={onlyReplies} onCheckedChange={onOnlyReplies} />
          <Label htmlFor="only-replies">{t('runs.group.onlyReplies')}</Label>
        </div>
      ) : null}
      {'kind' in row ? (
        <span className="text-xs text-muted-foreground">{t('runs.system.badge')}</span>
      ) : null}
      {run ? null : entryBadge(row, t)}
      {caps.retryDelivery ? (
        <Button
          variant="outline"
          size="sm"
          loading={busy || delivering}
          disabled={delivering}
          onClick={() => void act(() => (onDeliver ? onDeliver() : Promise.resolve()))}
        >
          <RotateCcw />
          {t('runs.system.retryDelivery')}
        </Button>
      ) : null}
      {canSkip && run && skippable ? (
        <Button
          variant="outline"
          size="sm"
          loading={skipper.pending !== null}
          onClick={() => void skipper.toggle(skippable, true, { allGroups: run.groups.length > 1 })}
        >
          <SkipForward />
          {t('runs.group.skipStep')}
        </Button>
      ) : null}
      {caps.cancel ? (
        <Button variant="destructive" size="sm" loading={busy} onClick={() => void cancelGroup()}>
          {t('runs.group.cancel')}
        </Button>
      ) : null}
      {caps.retry ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              aria-label={t('runs.group.more', { title })}
              title={t('runs.group.more', { title })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void act(
                  () => api.retry(runId, row.slug),
                  () => notifySuccess(t('runs.header.retryStarted')),
                )
              }
            >
              <RotateCcw />
              {t('runs.group.retry')}
            </DropdownMenuItem>
            {row.status !== 'conflict' ? (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() =>
                  void act(
                    () => api.retry(runId, row.slug, { refreshConfig: true }),
                    () => notifySuccess(t('runs.header.retryStarted')),
                  )
                }
              >
                <RefreshCw />
                {t('runs.group.retryRefreshConfig')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
  const details = (
    <>
      <span className="font-medium text-foreground" title={row.step ?? undefined}>
        {row.stepName ?? row.step ?? '—'}
      </span>
      {row.round !== null ? <span>{t('runs.group.round', { round: row.round })}</span> : null}
      {row.limitUntil !== null ? (
        <span className="text-status-warn">
          {t('runs.group.limitUntil', { time: clock(row.limitUntil) })}
        </span>
      ) : null}
      {'kind' in row && row.kind !== 'split' && stage ? (
        <span
          role="status"
          aria-label={t('runs.system.delivery')}
          className="flex flex-wrap items-center gap-x-2"
        >
          {stage.status === 'delivering' ? (
            <StatusBadge status="running" label={t('runs.system.delivering')} />
          ) : stage.status === 'applied' || stage.status === 'apply_failed' ? (
            <>
              <StatusBadge status={stage.status} />
              {attemptAt !== null ? (
                <span>{t('runs.system.lastAttempt', { time: clock(attemptAt) })}</span>
              ) : null}
              {stage.status === 'apply_failed' && stage.reason ? (
                <span className="min-w-0 truncate" title={stage.reason}>
                  {stage.reason.split('\n')[0]}
                </span>
              ) : null}
            </>
          ) : null}
        </span>
      ) : null}
      {showUsage ? (
        <>
          <span>{duration(row.durationMs)}</span>
          {usageText(row.usage) ? <span>{usageText(row.usage)}</span> : null}
          {cost(row.usage) ? <span>{cost(row.usage)}</span> : null}
        </>
      ) : null}
    </>
  );

  return (
    <section
      aria-label={t('runs.group.label', { title })}
      className="flex flex-col gap-3 p-4"
      style={{ '--group-header-height': `${headerHeight}px` } as React.CSSProperties}
    >
      <header
        ref={setHeader}
        className={`sticky top-0 z-10 -mx-4 -mt-4 flex flex-col border-b bg-background/95 px-4 py-3 backdrop-blur ${run ? '' : 'gap-2'}`}
      >
        {run ? (
          <>
            <div
              data-slot="group-header-collapse"
              aria-hidden={showUsage ? undefined : true}
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                showUsage ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  data-slot="group-header-title-row"
                  className="flex items-center gap-3 pb-2 [&>h2]:min-w-32"
                >
                  {heading}
                  <div data-slot="group-header-statuses" className="flex min-w-0 justify-end">
                    {statusesMounted ? (
                      <RunStatuses run={run} entry={row} onSelect={onSelectEntry} layout="inline" />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <div
              data-slot="group-header-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-2"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {details}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
            </div>
          </>
        ) : (
          <>
            <div data-slot="group-header-row" className="flex flex-wrap items-center gap-2">
              {heading}
              {actions}
            </div>
            <div
              data-slot="group-header-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
            >
              {details}
            </div>
          </>
        )}
      </header>
      {deliveryFailed ? (
        <Alert variant="destructive" className="flex flex-col gap-2">
          <b>{t('runs.system.deliveryFailed')}</b>
          {view?.delivery.finishedAt != null ? (
            <span className="text-xs">
              {t('runs.system.lastAttempt', { time: clock(view.delivery.finishedAt) })}
            </span>
          ) : null}
          {reason ? (
            <>
              <pre className="font-mono text-xs break-words whitespace-pre-wrap">
                {reasonOpen ? reason : reason.split('\n').slice(0, REASON_LINES).join('\n')}
              </pre>
              {reason.split('\n').length > REASON_LINES ? (
                <button
                  type="button"
                  className="self-start text-xs underline"
                  onClick={() => setReasonOpen(!reasonOpen)}
                >
                  {reasonOpen ? t('runs.system.showLess') : t('runs.system.showAll')}
                </button>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={busy || delivering}
              disabled={!deliverable || delivering}
              onClick={() => void act(() => (onDeliver ? onDeliver() : Promise.resolve()))}
            >
              <RotateCcw />
              {t('runs.system.retryDelivery')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!deliverable || delivering || !run}
              onClick={() => setForcing(true)}
            >
              {t('runs.system.forceDeliver')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!deliverable || delivering || !run}
              onClick={() => void markDelivered()}
            >
              {t('runs.system.markDelivered')}
            </Button>
          </div>
        </Alert>
      ) : null}
      {messaging !== null ? (
        <MessageDialog
          onSend={async (text) => {
            try {
              await api.message(runId, row.slug, messaging, text);
            } catch (error) {
              onError((error as Error).message);
              throw error;
            }
            notifySuccess(t('runs.message.sent'));
          }}
          onClose={() => setMessaging(null)}
        />
      ) : null}
      {forcing && run ? (
        <ApplyDialog
          run={run}
          api={api}
          onConfirm={() => {
            setForcing(false);
            void act(() => (onForceDeliver ? onForceDeliver() : api.apply(run.id, true)));
          }}
          onClose={() => setForcing(false)}
        />
      ) : null}

      {row.status === 'needs_human' && row.humanOnly ? (
        <section
          aria-label={t(`runs.humanOnly.${row.humanOnly}`)}
          className="flex flex-wrap items-center gap-2"
        >
          <Badge variant="warn">{t(`runs.humanOnly.${row.humanOnly}`)}</Badge>
          <span className="text-xs text-muted-foreground">{t('runs.humanOnly.hint')}</span>
          {row.humanOnly === 'review' ? (
            <Button
              size="sm"
              loading={busy}
              onClick={() =>
                void act(
                  () => api.answer(runId, row.slug, 'Принято'),
                  () => notifySuccess(t('runs.questions.answerSent')),
                )
              }
            >
              {t('runs.humanOnly.accept')}
            </Button>
          ) : null}
        </section>
      ) : null}
      {row.status === 'needs_human' ? (
        row.questions && row.questions.length > 0 ? (
          <QuestionsForm
            questions={row.questions}
            draftKey={draftKey}
            drafts={drafts}
            busy={busy}
            onDraft={onDraft}
            onClearDrafts={onClearDrafts}
            onSubmit={(answer, done) => void act(() => api.answer(runId, row.slug, answer), done)}
          />
        ) : (
          <QuestionCard
            title={title}
            question={row.question}
            draft={drafts[draftKey] ?? ''}
            busy={busy}
            onDraft={(text) => onDraft(draftKey, text)}
            onSubmit={(answer, done) => void act(() => api.answer(runId, row.slug, answer), done)}
          />
        )
      ) : null}
      {notice ? (
        notice.kind === 'outside' ? (
          <OutsideChanges attempt={notice.attempt} onDismiss={() => dismiss(notice.key)} />
        ) : notice.kind === 'hints' ? (
          <section aria-label={t('runs.group.hintsLabel')}>
            <Alert variant="warn" className="relative pr-10">
              {closeButton}
              <div className="mb-1 text-xs font-medium uppercase">{t('runs.group.hintsTitle')}</div>
              <p>
                {t('runs.group.hintsAdd')} <code>allow_commands</code>:{' '}
                {notice.patterns.map((pattern, index) => (
                  <span key={pattern}>
                    {index > 0 ? ', ' : ''}
                    <code>{pattern}</code>
                  </span>
                ))}
                {t('runs.group.hintsAfter')} <FilePath path="aip/specialists/" />.
              </p>
            </Alert>
          </section>
        ) : (
          <Alert
            variant={notice.kind === 'reason' ? 'destructive' : 'warn'}
            className="relative pr-10"
          >
            {closeButton}
            {notice.kind === 'reason' ? reasonLabel(notice.text, t) : notice.text}
          </Alert>
        )
      ) : null}

      {view === null ? (
        <div role="status" aria-label={t('runs.group.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={t('runs.group.tabs')}>
            <TabsTrigger value="log">{t('runs.group.log')}</TabsTrigger>
            {caps.changes ? (
              <TabsTrigger value="changes">
                {t('runs.group.changes')}
                {view.diff ? ` · ${view.diff.files.length}` : ''}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="task">{t('runs.group.task')}</TabsTrigger>
            {spec?.design != null ? (
              <TabsTrigger value="design">{t('runs.group.design')}</TabsTrigger>
            ) : null}
            {spec?.tasks != null ? (
              <TabsTrigger value="tasks">
                {t('runs.group.tasks')}
                {progress ? ` · ${progress.done}/${progress.total}` : ''}
              </TabsTrigger>
            ) : null}
            <TabsTrigger
              value="artifacts"
              disabled={row.artifacts === 0}
              title={row.artifacts === 0 ? t('runs.group.artifactsEmpty') : undefined}
            >
              {t('runs.group.artifacts')}
              {row.artifacts > 0 ? ` · ${row.artifacts}` : ''}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="log" className="flex flex-col gap-3">
            <AttemptTimeline
              api={api}
              runId={runId}
              group={row.slug}
              attempts={view.attempts}
              openSeq={openSeq}
              lastSeq={lastSeq}
              rawLog={view.log ? view.log.lines : null}
              onlyReplies={onlyReplies}
              showJson={false}
              onMessage={() => setMessaging(lastSeq)}
              retryable={caps.retry && (row.status === 'failed' || row.status === 'cancelled')}
              onRetry={() =>
                void act(
                  () => api.retry(runId, row.slug),
                  () => notifySuccess(t('runs.header.retryStarted')),
                )
              }
            />
          </TabsContent>
          {caps.changes ? (
            <TabsContent value="changes">
              {view.diff && view.diff.files.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <div className="text-sm text-muted-foreground">
                    <DiffStat
                      diff={{
                        files: view.diff.files.length,
                        added: view.diff.added,
                        removed: view.diff.removed,
                      }}
                    />
                  </div>
                  <FileTree
                    files={view.diff.files}
                    diff={{ api, runId, group: row.slug, revision: view.diff.revision }}
                  />
                </div>
              ) : (
                <Empty title={t('runs.group.noChanges')}>{t('runs.group.noChangesText')}</Empty>
              )}
            </TabsContent>
          ) : null}
          <TabsContent value="task">
            <section
              aria-label={t('runs.group.task')}
              className="rounded-md border bg-card p-4 text-card-foreground"
            >
              <Markdown text={view.task} />
            </section>
          </TabsContent>
          {spec?.design != null ? (
            <TabsContent value="design">
              <section
                aria-label={t('runs.group.design')}
                className="rounded-md border bg-card p-4 text-card-foreground"
              >
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('runs.group.specChange', { name: spec.change })}
                </p>
                <Markdown text={spec.design} />
              </section>
            </TabsContent>
          ) : null}
          {spec?.tasks != null ? (
            <TabsContent value="tasks">
              <section
                aria-label={t('runs.group.tasks')}
                className="rounded-md border bg-card p-4 text-card-foreground"
              >
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('runs.group.specChange', { name: spec.change })}
                </p>
                <Markdown text={spec.tasks} />
              </section>
            </TabsContent>
          ) : null}
          {row.artifacts > 0 ? (
            <TabsContent value="artifacts">
              <ArtifactsTab
                api={api}
                runId={runId}
                group={row.slug}
                count={row.artifacts}
                revision={row.artifactsRevision}
                onError={onError}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </section>
  );
}
