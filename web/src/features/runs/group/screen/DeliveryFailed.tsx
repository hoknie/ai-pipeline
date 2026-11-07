import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clock } from '../../../../shared/lib/format.ts';
import { Alert } from '../../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import type { GroupCtx } from './useGroupCtx.ts';

/** Lines of a delivery failure shown before «Show all». */
const REASON_LINES = 6;

function Reason({ reason }: { reason: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <pre className="font-mono text-xs break-words whitespace-pre-wrap">
        {open ? reason : reason.split('\n').slice(0, REASON_LINES).join('\n')}
      </pre>
      {reason.split('\n').length > REASON_LINES ? (
        <button
          type="button"
          className="self-start text-xs underline"
          onClick={() => setOpen(!open)}
        >
          {open ? t('runs.system.showLess') : t('runs.system.showAll')}
        </button>
      ) : null}
    </>
  );
}

/** A group that was merged but whose delivery failed: the reason and the ways forward. */
export function DeliveryFailed({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { row, run, view, busy, act, delivering, deliverable } = ctx;
  if ('kind' in row || row.status !== 'merged' || row.delivery !== 'apply_failed') return null;
  const reason = view?.delivery.reason ?? null;
  return (
    <Alert variant="destructive" className="flex flex-col gap-2">
      <b>{t('runs.system.deliveryFailed')}</b>
      {view?.delivery.finishedAt != null ? (
        <span className="text-xs">
          {t('runs.system.lastAttempt', { time: clock(view.delivery.finishedAt) })}
        </span>
      ) : null}
      {reason ? <Reason reason={reason} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          loading={busy || delivering}
          disabled={!deliverable || delivering}
          onClick={() => void act(() => (ctx.onDeliver ? ctx.onDeliver() : Promise.resolve()))}
        >
          <RotateCcw />
          {t('runs.system.retryDelivery')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!deliverable || delivering || !run}
          onClick={() => ctx.setForcing(true)}
        >
          {t('runs.system.forceDeliver')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!deliverable || delivering || !run}
          onClick={() => void ctx.markDelivered()}
        >
          {t('runs.system.markDelivered')}
        </Button>
      </div>
    </Alert>
  );
}
