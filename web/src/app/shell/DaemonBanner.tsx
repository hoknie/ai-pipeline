import { useTranslation } from 'react-i18next';

import type { DaemonMismatch } from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';

/** Warning that the daemon runs another build than `aip web`, with the way to fix it. */
export function DaemonBanner({ daemon }: { daemon: DaemonMismatch }) {
  const { t } = useTranslation();
  if (!daemon) return null;
  const pid = daemon.pid === null ? '' : ` (pid ${daemon.pid})`;
  const build = (info: { version: string; fingerprint: string } | null) =>
    info ? `${info.version} ${info.fingerprint}` : t('daemon.unknownBuild');
  const text =
    daemon.outdated === 'client'
      ? t('daemon.newer')
      : t(daemon.daemon ? 'daemon.olderBusy' : 'daemon.olderUnknown', { pid });
  return (
    <Alert variant="warn" className="m-3 mb-0 flex w-auto flex-col gap-1">
      <span>
        {text}
        {daemon.outdated === 'daemon' && daemon.pid !== null ? (
          <>
            {' '}
            <code>kill {daemon.pid}</code>
          </>
        ) : null}
      </span>
      <span className="text-xs opacity-80">
        {t('daemon.builds', { daemon: build(daemon.daemon), panel: build(daemon.client) })}
      </span>
    </Alert>
  );
}
