import { MoreHorizontal, RefreshCw, RotateCcw, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  clock,
  cost,
  duration,
  runTitle,
  taskNumber,
  usageText,
} from '../../../../shared/lib/format.ts';
import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import { isRepairStep } from '../../../../shared/api/observerTypes.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../../shared/ui/forms/switch.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../shared/ui/overlays/dropdown-menu.tsx';
import { StatusBadge } from '../../../../shared/ui/feedback/StatusBadge.tsx';
import { RunStatuses, entryBadge } from '../../list/RunStatuses.tsx';
import type { GroupCtx } from './useGroupCtx.ts';

function Heading({ ctx }: { ctx: GroupCtx }) {
  const { run, title, showUsage } = ctx;
  return (
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
}

function RetryMenu({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { api, runId, row, busy, act, title } = ctx;
  const retry = (options?: { refreshConfig: true }) =>
    void act(
      () => (options ? api.retry(runId, row.slug, options) : api.retry(runId, row.slug)),
      () => notifySuccess(t('runs.header.retryStarted')),
    );
  return (
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
        <DropdownMenuItem disabled={busy} onSelect={() => retry()}>
          <RotateCcw />
          {t('runs.group.retry')}
        </DropdownMenuItem>
        {row.status !== 'conflict' ? (
          <DropdownMenuItem disabled={busy} onSelect={() => retry({ refreshConfig: true })}>
            <RefreshCw />
            {t('runs.group.retryRefreshConfig')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Actions({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { row, run, busy, act, caps, delivering, skip } = ctx;
  return (
    <>
      {ctx.onOnlyReplies ? (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Switch id="only-replies" checked={ctx.onlyReplies} onCheckedChange={ctx.onOnlyReplies} />
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
          onClick={() => void act(() => (ctx.onDeliver ? ctx.onDeliver() : Promise.resolve()))}
        >
          <RotateCcw />
          {t('runs.system.retryDelivery')}
        </Button>
      ) : null}
      {skip.canSkip && run && skip.skippable ? (
        <Button
          variant="outline"
          size="sm"
          loading={skip.skipper.pending !== null}
          onClick={() =>
            void skip.skipper.toggle(skip.skippable!, true, { allGroups: run.groups.length > 1 })
          }
        >
          <SkipForward />
          {t('runs.group.skipStep')}
        </Button>
      ) : null}
      {caps.cancel ? (
        <Button
          variant="destructive"
          size="sm"
          loading={busy}
          onClick={() => void ctx.cancelGroup()}
        >
          {t('runs.group.cancel')}
        </Button>
      ) : null}
      {caps.retry ? <RetryMenu ctx={ctx} /> : null}
    </>
  );
}

function DeliveryStage({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const stage = ctx.run?.deliveryStage ?? null;
  const attemptAt = ctx.run?.delivery.finishedAt ?? null;
  if (!stage) return null;
  return (
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
  );
}

function Details({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { row, showUsage } = ctx;
  return (
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
      {'kind' in row && row.kind !== 'split' && row.kind !== 'action' && !isRepairStep(row) ? (
        <DeliveryStage ctx={ctx} />
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
}

function RunHeaderRows({ ctx, run }: { ctx: GroupCtx; run: NonNullable<GroupCtx['run']> }) {
  const { row, showUsage } = ctx;
  return (
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
            <Heading ctx={ctx} />
            <div data-slot="group-header-statuses" className="flex min-w-0 justify-end">
              {ctx.statusesMounted ? (
                <RunStatuses run={run} entry={row} onSelect={ctx.onSelectEntry} layout="inline" />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div data-slot="group-header-row" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Details ctx={ctx} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Actions ctx={ctx} />
        </div>
      </div>
    </>
  );
}

/** The sticky header of the screen: the title, the statuses, the facts and the buttons. */
export function GroupHeader({
  ctx,
  onHeight,
}: {
  ctx: GroupCtx;
  onHeight: (header: HTMLElement | null) => void;
}) {
  const { run } = ctx;
  return (
    <header
      ref={onHeight}
      className={`sticky top-0 z-10 -mx-4 -mt-4 flex flex-col border-b bg-background/95 px-4 py-3 backdrop-blur ${run ? '' : 'gap-2'}`}
    >
      {run ? (
        <RunHeaderRows ctx={ctx} run={run} />
      ) : (
        <>
          <div data-slot="group-header-row" className="flex flex-wrap items-center gap-2">
            <Heading ctx={ctx} />
            <Actions ctx={ctx} />
          </div>
          <div
            data-slot="group-header-row"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
          >
            <Details ctx={ctx} />
          </div>
        </>
      )}
    </header>
  );
}
