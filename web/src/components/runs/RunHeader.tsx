import { MoreHorizontal, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { runTitle, taskNumber } from '../../format.ts';
import { notifySuccess } from '../../notify.ts';
import type { GroupRow, RunView, SystemStepRow, TagView } from '../../types.ts';
import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { useTags } from '../../tags.tsx';
import { TagPicker } from '../TagPicker.tsx';
import { RunSteps } from './RunSteps.tsx';
import { RunSummary } from './RunSummary.tsx';

import { canDeliver } from './delivery.ts';
import { ApplyDialog } from './ApplyDialog.tsx';

export function RunHeader({
  run,
  api,
  now,
  onError,
  onSelect,
  onDeliver,
  headerRef,
  entry = null,
}: {
  run: RunView;
  api: Api;
  now: number;
  onError: (message: string) => void;
  /** Opens a group or a system step of the run. */
  onSelect?: (slug: string) => void;
  /** Delivers the run and reports the outcome; without it the header only calls `apply`. */
  onDeliver?: (force: boolean) => Promise<unknown>;
  /** Receives the header element, to know when it is scrolled out of view. */
  headerRef?: (element: HTMLElement | null) => void;
  /** The open group or system step; its status joins the statuses of the summary. */
  entry?: GroupRow | SystemStepRow | null;
}) {
  const { t } = useTranslation();
  const [forcing, setForcing] = useState(false);
  const [retrying, setRetrying] = useState<'plain' | 'refresh' | null>(null);
  const [applying, setApplying] = useState(false);
  const [returning, setReturning] = useState(false);
  const putBack = async () => {
    setReturning(true);
    try {
      await api.queueReturn(run.id, run.repository);
      notifySuccess(t('runs.header.returned'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setReturning(false);
    }
  };
  const [pausing, setPausing] = useState(false);
  const pause = async () => {
    setPausing(true);
    try {
      await api.pauseRun(run.id, run.repository);
      notifySuccess(t('runs.header.paused'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPausing(false);
    }
  };
  const pausable = !run.finished && run.hold === null && run.queueItem === null;
  const [tagging, setTagging] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const { byId } = useTags();
  const runTagIds = (run.tags ?? []).map((tag) => tag.id);
  const changeTags = async (ids: string[], fresh?: TagView[]) => {
    const lookup = fresh ? new Map(fresh.map((tag) => [tag.id, tag])) : byId;
    const names = (list: string[]) =>
      list.flatMap((id) => {
        const tag = lookup.get(id);
        return tag && !tag.task ? tag.name : [];
      });
    const add = names(ids.filter((id) => !runTagIds.includes(id)));
    const remove = names(runTagIds.filter((id) => !ids.includes(id)));
    if (add.length === 0 && remove.length === 0) return;
    setTagging(true);
    setTagError(null);
    try {
      await api.setRunTags(run.id, {
        ...(add.length > 0 ? { add } : {}),
        ...(remove.length > 0 ? { remove } : {}),
      });
    } catch (error) {
      setTagError((error as Error).message);
    } finally {
      setTagging(false);
    }
  };
  const retryable = (status: string) => status === 'failed' || status === 'cancelled';
  const failed: { slug: string; title: string; status: string }[] = run.groups.filter((group) =>
    retryable(group.status),
  );
  if (run.split && retryable(run.split.status)) {
    failed.unshift({ slug: '_split', title: t('runs.header.split'), status: run.split.status });
  }
  const hasCancelled = failed.some((group) => group.status === 'cancelled');
  const retryFailed = async (refreshConfig: boolean) => {
    setRetrying(refreshConfig ? 'refresh' : 'plain');
    const refused: string[] = [];
    for (const group of failed) {
      try {
        if (refreshConfig) await api.retry(run.id, group.slug, { refreshConfig: true });
        else await api.retry(run.id, group.slug);
      } catch (error) {
        refused.push(`${group.title}: ${(error as Error).message}`);
      }
    }
    setRetrying(null);
    if (refused.length > 0) onError(t('runs.header.retryRefused', { list: refused.join('; ') }));
    else notifySuccess(t('runs.header.retryStarted'));
  };
  const deliverable = canDeliver(run);
  const apply = async (force: boolean) => {
    setForcing(false);
    setApplying(true);
    try {
      await (onDeliver ? onDeliver(force) : api.apply(run.id, force));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setApplying(false);
    }
  };
  return (
    <header ref={headerRef} aria-label={t('runs.header.label')} className="@container border-b p-4">
      <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1
              className="min-w-0 flex-1 text-lg font-semibold break-words [overflow-wrap:anywhere]"
              title={`${runTitle(run)}\n${run.id}`}
            >
              <span className="font-mono text-base font-normal text-muted-foreground">
                {taskNumber(run.number)}
              </span>{' '}
              {runTitle(run)}
            </h1>
          </div>
          {run.name ? (
            <div className="font-mono text-xs text-muted-foreground">{run.name}</div>
          ) : null}
          <div className="flex flex-col gap-1">
            <TagPicker
              label={t('runs.header.tags')}
              selected={runTagIds}
              onChange={(ids, fresh) => void changeTags(ids, fresh)}
              api={api}
              allowCreate
              disabled={tagging}
              hideLinked
            />
            {tagError ? <Alert variant="destructive">{tagError}</Alert> : null}
          </div>
          {run.dirtyWarning ? <Alert variant="warn">{t('runs.header.dirty')}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            {pausable ? (
              <Button variant="outline" loading={pausing} onClick={() => void pause()}>
                {t('runs.header.pause')}
              </Button>
            ) : null}
            {run.returnable ? (
              <Button variant="outline" loading={returning} onClick={() => void putBack()}>
                {t('runs.header.returnRun')}
              </Button>
            ) : null}
            <Button loading={applying} disabled={!deliverable} onClick={() => void apply(false)}>
              {t('runs.header.deliver')}
            </Button>
            <RunSteps run={run} api={api} onError={onError} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label={t('runs.header.more')}>
                  <MoreHorizontal />
                  {t('runs.header.more')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {failed.length > 0 ? (
                  <>
                    <DropdownMenuItem
                      disabled={retrying !== null}
                      onSelect={() => void retryFailed(false)}
                    >
                      <RotateCcw
                        className={retrying === 'plain' ? 'motion-safe:animate-spin' : undefined}
                      />
                      {hasCancelled
                        ? t('runs.header.retryFailedCancelled')
                        : t('runs.header.retryFailed')}{' '}
                      ({failed.length})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={retrying !== null}
                      onSelect={() => void retryFailed(true)}
                    >
                      <RefreshCw
                        className={retrying === 'refresh' ? 'motion-safe:animate-spin' : undefined}
                      />
                      {t('runs.header.retryRefreshConfig')} ({failed.length})
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
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
          </div>
        </div>
        <RunSummary run={run} now={now} entry={entry} onSelect={onSelect} />
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
