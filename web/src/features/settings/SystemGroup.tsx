import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { NetworkStatus } from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { DaemonCard } from './system/DaemonCard.tsx';
import { NetworkCard } from './system/NetworkCard.tsx';
import { useSystem } from './system/useSystem.ts';
import { WebCard } from './system/WebCard.tsx';

export { RESTART_POLL_MS, RESTART_WAIT_MS, SYSTEM_POLL_MS } from './system/actions.ts';

/** State of the daemon and of the panel, their restarts, and stopping and starting the daemon. */
export function SystemGroup({
  api,
  streamedNetwork,
  onRestarted,
}: {
  api: Api;
  /** The last `network` event of the stream; it is fresher than the view until the next poll. */
  streamedNetwork: NetworkStatus | null;
  onRestarted: () => void;
}) {
  const { t } = useTranslation();
  const { view, offline, pending, failure, run } = useSystem(api, onRestarted);
  if (!view) {
    return offline ? (
      <Alert variant="destructive">{t('system.offline')}</Alert>
    ) : (
      <div role="status" aria-label={t('system.loading')}>
        <Skeleton className="h-32" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" aria-label={t('system.label')} role="region">
      {offline ? <Alert variant="warn">{t('system.offline')}</Alert> : null}
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {view.daemon.mismatch ? (
        <Alert variant="warn">
          {t(view.daemon.mismatch === 'daemon' ? 'system.mismatchDaemon' : 'system.mismatchPanel')}
        </Alert>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <DaemonCard view={view} pending={pending} run={run} />
        <WebCard view={view} pending={pending} run={run} />
        <NetworkCard network={streamedNetwork ?? view.network} />
      </div>
    </div>
  );
}
