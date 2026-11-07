import { useTranslation } from 'react-i18next';

import { clock } from '../../../shared/lib/format.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { QueueView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { reasonText } from './reasonText.ts';

/** Why the queue stopped: an item that failed to start, a usage limit or a problem of a run. */
export function StopReason({ queue }: { queue: QueueView }) {
  const { t } = useTranslation();
  const stop = queue.stop;
  if (!stop) return null;
  if (stop.kind === 'item') {
    return (
      <Alert variant="warn" role="status">
        {t('queue.stopItem', { item: stop.item, error: stop.error })}
      </Alert>
    );
  }
  const route = formatRoute({
    view: 'runs',
    run: stop.run,
    group: stop.group,
    step: null,
    tab: null,
  });
  if (stop.kind === 'limit') {
    return (
      <Alert variant="warn" role="status">
        {t('queue.stopped')} {t('queue.limitStop', { runtime: stop.runtime })},{' '}
        {t('queue.limitResets', { time: clock(stop.resetsAt) })}.{' '}
        {stop.autoResume ? `${t('queue.limitResumes', { time: clock(stop.resetsAt) })} ` : null}
        <a className="underline" href={route}>
          {t('queue.openGroup', { group: stop.group })}
        </a>
      </Alert>
    );
  }
  return (
    <Alert variant="warn" role="status">
      {t('queue.stopped')} <code>{stop.reason}</code> — {reasonText(stop.reason, t)}.{' '}
      <a className="underline" href={route}>
        {stop.group ? t('queue.openGroup', { group: stop.group }) : t('queue.openRun')}
      </a>
    </Alert>
  );
}
