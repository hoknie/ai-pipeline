import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { QueueRunView, QueueView } from '../../../shared/api/types.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { RunCard } from './RunCard.tsx';

/** Putting a skipped run back and dismissing it, one at a time. */
function useSkippedActions(
  queue: QueueView,
  api: Api,
  onQueue: (queue: QueueView) => void,
  onError: (message: string) => void,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [returning, setReturning] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const putBack = async (run: string) => {
    setReturning(run);
    try {
      onQueue(await api.queueReturn(run, queue.repository));
      notifySuccess(t('queue.returned'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setReturning(null);
    }
  };
  const dismiss = async (run: QueueRunView) => {
    const yes = await confirm({
      title: t('queue.dismissTitle', { run: run.title }),
      description: t('queue.dismissDescription'),
      confirmLabel: t('queue.dismissRun'),
      cancelLabel: t('queue.list.keep'),
      destructive: true,
    });
    if (!yes) return;
    setDismissing(run.id);
    try {
      onQueue(await api.queueDismiss(run.id, queue.repository));
      notifySuccess(t('queue.dismissed'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setDismissing(null);
    }
  };
  return { returning, dismissing, putBack, dismiss };
}

/** Runs taken off the places by a stopping problem; they do not count as places taken. */
export function SkippedRuns({
  queue,
  now,
  api,
  onQueue,
  onError,
}: {
  queue: QueueView;
  now: number;
  api: Api;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { returning, dismissing, putBack, dismiss } = useSkippedActions(
    queue,
    api,
    onQueue,
    onError,
  );
  const busy = returning !== null || dismissing !== null;
  return (
    <section aria-label={t('queue.skippedLabel')}>
      <h3 className="mb-2 font-semibold">{t('queue.skipped', { count: queue.skipped.length })}</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {queue.skipped.map((run) => (
          <li key={run.id} className="min-w-0">
            <RunCard
              run={run}
              now={now}
              linked={false}
              action={
                <div className="flex flex-wrap gap-2">
                  {run.returnable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={returning === run.id}
                      disabled={busy}
                      onClick={() => void putBack(run.id)}
                    >
                      {t('queue.returnRun')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    loading={dismissing === run.id}
                    disabled={busy}
                    onClick={() => void dismiss(run)}
                  >
                    {t('queue.dismissRun')}
                  </Button>
                </div>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
