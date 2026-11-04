import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Api } from '../../api.ts';
import { notifyError, notifySuccess } from '../../notify.ts';
import type { RunView } from '../../types.ts';

import { applyOutcome, settledOutcome, type ApplyOutcome, type DeliveryWatch } from './delivery.ts';

/** Characters of a failure reason in a notification; the screen of the group shows it whole. */
const REASON_CHARS = 200;

function firstLine(reason: string | null): string {
  const line = (reason ?? '').split('\n')[0]?.trim() ?? '';
  return line.length > REASON_CHARS ? `${line.slice(0, REASON_CHARS)}…` : line;
}

function report(t: TFunction, outcome: ApplyOutcome, failedBefore: boolean): void {
  if (outcome.kind === 'applied') notifySuccess(t('runs.system.delivered'));
  else if (outcome.kind === 'failed') {
    notifyError(
      t(failedBefore ? 'runs.system.deliveryFailedAgain' : 'runs.system.deliveryFailedWith', {
        reason: firstLine(outcome.reason),
      }),
    );
  }
}

/**
 * Starts deliveries of the panel and reports their outcome: at once when the answer of `apply`
 * carries it, otherwise when the run gets a new delivery time.
 */
export function useDeliveryOutcome(
  api: Api,
  runs: RunView[],
): (run: RunView, force: boolean) => Promise<void> {
  const { t } = useTranslation();
  const [watches, setWatches] = useState<Record<string, DeliveryWatch>>({});

  useEffect(() => {
    const done: string[] = [];
    const busy: string[] = [];
    for (const [runId, watch] of Object.entries(watches)) {
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) continue;
      const outcome = settledOutcome(run, watch);
      if (outcome === null) {
        if (run.delivery.inProgress && !watch.busy) busy.push(runId);
        continue;
      }
      done.push(runId);
      if (outcome.kind !== 'cancelled' && outcome.kind !== 'pending') {
        report(t, outcome, watch.failedBefore);
      }
    }
    if (busy.length > 0) {
      setWatches((current) => {
        const next = { ...current };
        for (const id of busy) {
          const watch = next[id];
          if (watch) next[id] = { ...watch, busy: true };
        }
        return next;
      });
    }
    if (done.length > 0) {
      setWatches((current) => {
        const next = { ...current };
        for (const id of done) delete next[id];
        return next;
      });
    }
  }, [runs, watches, t]);

  return useCallback(
    async (run: RunView, force: boolean) => {
      const watch: DeliveryWatch = {
        since: run.delivery.finishedAt,
        failedBefore: run.delivery.failed > 0,
        busy: false,
      };
      const result = await api.apply(run.id, force);
      const outcome = applyOutcome(result);
      if (outcome.kind === 'pending') {
        notifySuccess(t('runs.system.deliveryStarted'));
        setWatches((current) => ({ ...current, [run.id]: watch }));
      } else {
        report(t, outcome, watch.failedBefore);
      }
    },
    [api, t],
  );
}
