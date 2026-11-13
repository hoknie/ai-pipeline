import { ListPlus, MoreHorizontal, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { repairOf } from '../../../shared/api/observerTypes.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/overlays/dropdown-menu.tsx';
import type { useRetryFailed, useRunDelivery, useRunHold, useRunObserver } from './useRunHeader.ts';

type Repair = ReturnType<typeof repairOf>;

/** Warnings about the run: a dirty tree and what the observer may not do. */
export function RunWarnings({ run, repair }: { run: RunView; repair: Repair }) {
  const { t } = useTranslation();
  return (
    <>
      {run.dirtyWarning ? <Alert variant="warn">{t('runs.header.dirty')}</Alert> : null}
      {repair && !repair.allowed ? (
        <Alert variant="warn" data-testid="observer-forbidden">
          {t('runs.header.observerForbidden')}
        </Alert>
      ) : null}
      {repair?.cancelReason ? (
        <Alert variant="warn" data-testid="observer-cancel-reason">
          {t('runs.header.observerCancelReason', { reason: repair.cancelReason })}
        </Alert>
      ) : null}
    </>
  );
}

/** The buttons of the observer, the queue and the delivery. */
export function RunButtons({
  run,
  repair,
  observer,
  hold,
  delivery,
}: {
  run: RunView;
  repair: Repair;
  observer: ReturnType<typeof useRunObserver>;
  hold: ReturnType<typeof useRunHold>;
  delivery: ReturnType<typeof useRunDelivery>;
}) {
  const { t } = useTranslation();
  const { observing, setObserver, observerError } = observer;
  const { continueItem } = hold;
  return (
    <>
      {repair?.active ? (
        <Button variant="outline" loading={observing} onClick={() => void setObserver(false)}>
          {t('runs.header.observerCancel')}
        </Button>
      ) : null}
      {repair && !repair.allowed ? (
        <Button variant="outline" loading={observing} onClick={() => void setObserver(true)}>
          {t('runs.header.observerGiveBack')}
        </Button>
      ) : null}
      {observerError ? (
        <span role="alert" className="text-sm text-destructive">
          {observerError}
        </span>
      ) : null}
      {continueItem !== null ? (
        <Button
          variant="outline"
          loading={hold.continuing}
          onClick={() => void hold.resume(continueItem)}
        >
          {t('runs.header.continue')}
        </Button>
      ) : null}
      {hold.pausable ? (
        <Button variant="outline" loading={hold.pausing} onClick={() => void hold.pause()}>
          {t('runs.header.pause')}
        </Button>
      ) : null}
      {run.returnable ? (
        <Button variant="outline" loading={hold.returning} onClick={() => void hold.putBack()}>
          {t('runs.header.returnRun')}
        </Button>
      ) : null}
      {delivery.autoCancellable ? (
        <Button
          variant="outline"
          loading={delivery.cancellingAuto}
          onClick={() => void delivery.cancelAuto()}
        >
          {t('runs.header.cancelAutoDelivery')}
        </Button>
      ) : (
        <Button
          loading={delivery.applying}
          disabled={!delivery.deliverable}
          onClick={() => void delivery.apply(false)}
        >
          {t('runs.header.deliver')}
        </Button>
      )}
    </>
  );
}

function RetryItems({ retry }: { retry: ReturnType<typeof useRetryFailed> }) {
  const { t } = useTranslation();
  const { failed, retrying, hasCancelled } = retry;
  if (failed.length === 0) return null;
  return (
    <>
      <DropdownMenuItem disabled={retrying !== null} onSelect={() => void retry.retryFailed(false)}>
        <RotateCcw className={retrying === 'plain' ? 'motion-safe:animate-spin' : undefined} />
        {hasCancelled ? t('runs.header.retryFailedCancelled') : t('runs.header.retryFailed')} (
        {failed.length})
      </DropdownMenuItem>
      <DropdownMenuItem disabled={retrying !== null} onSelect={() => void retry.retryFailed(true)}>
        <RefreshCw className={retrying === 'refresh' ? 'motion-safe:animate-spin' : undefined} />
        {t('runs.header.retryRefreshConfig')} ({failed.length})
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

/** The menu «More»: retries, a subtask, forced delivery, marking delivered and copying the id. */
export function MoreMenu({
  run,
  retry,
  delivery,
  onSubtask,
}: {
  run: RunView;
  retry: ReturnType<typeof useRetryFailed>;
  delivery: ReturnType<typeof useRunDelivery>;
  onSubtask: ((run: RunView) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={t('runs.header.more')}>
          <MoreHorizontal />
          {t('runs.header.more')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <RetryItems retry={retry} />
        {onSubtask ? (
          <>
            <DropdownMenuItem onSelect={() => onSubtask(run)}>
              <ListPlus />
              {t('runs.header.subtask')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          disabled={!delivery.deliverable}
          onSelect={() => delivery.setForcing(true)}
        >
          {t('runs.header.forceDeliver')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!delivery.deliverable}
          onSelect={() => void delivery.markDelivered()}
        >
          {t('runs.header.markDelivered')}
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
  );
}
