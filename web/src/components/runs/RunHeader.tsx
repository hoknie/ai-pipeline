import { MoreHorizontal, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { cost, diffText, duration, runTitle } from '../../format.ts';
import { notifySuccess } from '../../notify.ts';
import { runStatusLabel } from '../../status.ts';
import type { RunView } from '../../types.ts';
import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { StatusBadge } from '../StatusBadge.tsx';
import { RunWarningsBadge } from './RunWarningsBadge.tsx';

import { ApplyDialog } from './ApplyDialog.tsx';

export function RunHeader({
  run,
  api,
  now,
  onError,
}: {
  run: RunView;
  api: Api;
  now: number;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [forcing, setForcing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const retryable = (status: string) => status === 'failed' || status === 'cancelled';
  const failed: { slug: string; title: string; status: string }[] = run.groups.filter((group) =>
    retryable(group.status),
  );
  if (run.split && retryable(run.split.status)) {
    failed.unshift({ slug: '_split', title: t('runs.header.split'), status: run.split.status });
  }
  const hasCancelled = failed.some((group) => group.status === 'cancelled');
  const retryFailed = async () => {
    setRetrying(true);
    const refused: string[] = [];
    for (const group of failed) {
      try {
        await api.retry(run.id, group.slug);
      } catch (error) {
        refused.push(`${group.title}: ${(error as Error).message}`);
      }
    }
    setRetrying(false);
    if (refused.length > 0) onError(t('runs.header.retryRefused', { list: refused.join('; ') }));
    else notifySuccess(t('runs.header.retryStarted'));
  };
  const { delivery } = run;
  const deliverable = delivery.merged > delivery.applied && !delivery.inProgress;
  const apply = async (force: boolean) => {
    setForcing(false);
    setApplying(true);
    try {
      await api.apply(run.id, force);
      notifySuccess(t('runs.header.applyStarted'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setApplying(false);
    }
  };
  const cancel = async () => {
    const yes = await confirm({
      title: t('runs.header.cancelTitle', { title: runTitle(run) }),
      description: t('runs.header.cancelDescription'),
      confirmLabel: t('runs.header.cancelRun'),
      cancelLabel: t('runs.header.keep'),
      destructive: true,
    });
    if (!yes) return;
    setCancelling(true);
    try {
      await api.cancel(run.id);
      notifySuccess(t('runs.header.cancelled'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setCancelling(false);
    }
  };
  return (
    <header aria-label={t('runs.header.label')} className="flex flex-col gap-2 border-b p-4">
      <h1 className="text-lg font-semibold" title={`${runTitle(run)}\n${run.id}`}>
        {runTitle(run)}
      </h1>
      {run.name ? <div className="font-mono text-xs text-muted-foreground">{run.name}</div> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <StatusBadge status={run.state} label={runStatusLabel(run, t)} />
        <RunWarningsBadge run={run} />
        <span>{run.workflow}</span>
        <span>{duration((run.finishedAt ?? now) - run.createdAt)}</span>
        {cost(run.usage) ? <span>{cost(run.usage)}</span> : null}
        {run.diff ? <span>{diffText(run.diff, t)}</span> : null}
        {delivery.merged > 0 ? (
          <span>
            {t('runs.header.delivery', { applied: delivery.applied, merged: delivery.merged })}
          </span>
        ) : null}
        {delivery.failed > 0 ? (
          <StatusBadge
            status="apply_failed"
            label={t('runs.header.deliveryFailed', { n: delivery.failed })}
          />
        ) : null}
        {delivery.inProgress ? (
          <StatusBadge status="running" label={t('runs.header.delivering')} />
        ) : null}
      </div>
      {run.resolver ? (
        <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span>{t('runs.header.resolver')}</span>
          <StatusBadge status={run.resolver.status} />
          <span>
            {t('runs.header.round', { round: run.resolver.round, rounds: run.resolver.rounds })}
          </span>
          {run.resolver.conflicts.length > 0 ? (
            <span>{t('runs.header.conflicts', { list: run.resolver.conflicts.join(', ') })}</span>
          ) : null}
        </div>
      ) : null}
      {run.dirtyWarning ? <Alert variant="warn">{t('runs.header.dirty')}</Alert> : null}
      {run.split && run.split.status !== 'done' ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{t('runs.header.split')}</span>
          <StatusBadge status={run.split.status} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {failed.length > 0 ? (
          <Button variant="outline" disabled={retrying} onClick={() => void retryFailed()}>
            <RotateCcw className={retrying ? 'motion-safe:animate-spin' : undefined} />
            {hasCancelled ? t('runs.header.retryFailedCancelled') : t('runs.header.retryFailed')} (
            {failed.length})
          </Button>
        ) : null}
        <Button loading={applying} disabled={!deliverable} onClick={() => void apply(false)}>
          {t('runs.header.deliver')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label={t('runs.header.more')}>
              <MoreHorizontal />
              {t('runs.header.more')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!deliverable} onSelect={() => setForcing(true)}>
              {t('runs.header.forceDeliver')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard?.writeText(run.id);
                notifySuccess(t('runs.header.copied'));
              }}
            >
              {t('runs.header.copyId')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!run.finished ? (
          <Button variant="destructive" loading={cancelling} onClick={() => void cancel()}>
            {t('runs.header.cancelRun')}
          </Button>
        ) : null}
        <span
          className="truncate text-xs text-muted-foreground"
          title={`${run.id} · ${run.branch}`}
        >
          {run.repository}
        </span>
      </div>
      {forcing ? (
        <ApplyDialog
          run={run}
          api={api}
          onConfirm={() => void apply(true)}
          onClose={() => setForcing(false)}
        />
      ) : null}
    </header>
  );
}
