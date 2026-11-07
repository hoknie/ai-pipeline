import { useTranslation } from 'react-i18next';

import type { SystemView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import type { Action } from './actions.ts';
import { Row } from './Row.tsx';

function DaemonButtons({
  view,
  pending,
  run,
  showRunning,
}: {
  view: SystemView;
  pending: Action | null;
  run: (action: Action) => Promise<void>;
  showRunning: boolean;
}) {
  const { t } = useTranslation();
  const standalone = view.web.servedBy === 'standalone';
  const standby = view.web.servedBy === 'standby';
  return (
    <div className="flex flex-wrap gap-2">
      {showRunning ? (
        <>
          <Button
            variant="outline"
            disabled={pending !== null || standalone}
            onClick={() => void run('daemonRestart')}
          >
            {pending === 'daemonRestart' ? t('system.restarting') : t('system.daemon.restart')}
          </Button>
          <Button
            variant="outline"
            disabled={pending !== null || standalone}
            onClick={() => void run('daemonStop')}
          >
            {pending === 'daemonStop' ? t('system.stopping') : t('system.daemon.stop')}
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          disabled={pending !== null || !standby}
          onClick={() => void run('daemonStart')}
        >
          {pending === 'daemonStart' ? t('system.starting') : t('system.daemon.start')}
        </Button>
      )}
    </div>
  );
}

/** The card of the daemon: its state and the buttons that restart, stop or start it. */
export function DaemonCard({
  view,
  pending,
  run,
}: {
  view: SystemView;
  pending: Action | null;
  run: (action: Action) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { daemon, web } = view;
  const standby = web.servedBy === 'standby';
  // The pending button stays in place while the regular poll sees the daemon go down or come up.
  const showRunning =
    pending === 'daemonRestart' || pending === 'daemonStop'
      ? true
      : pending === 'daemonStart'
        ? false
        : daemon.running;
  return (
    <section
      aria-label={t('system.daemon.title')}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('system.daemon.title')}</h3>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label={t('system.state')}>
          {daemon.running ? t('system.running') : t('system.notRunning')}
        </Row>
        {daemon.running ? (
          <>
            <Row label="pid">{daemon.pid ?? t('system.unknown')}</Row>
            <Row label={t('system.version')}>{daemon.version ?? t('system.unknown')}</Row>
            <Row label={t('system.build')}>
              <code>{daemon.build ?? t('system.unknown')}</code>
            </Row>
            <Row label={t('system.busy')}>
              {daemon.busy === null
                ? t('system.unknown')
                : daemon.busy
                  ? t('system.busyYes')
                  : t('system.busyNo')}
            </Row>
          </>
        ) : null}
        {view.logPath ? (
          <Row label={t('system.log')}>
            <FilePath path={view.logPath} />
          </Row>
        ) : null}
      </dl>
      {standby ? <p className="text-xs text-muted-foreground">{t('system.standby')}</p> : null}
      <DaemonButtons view={view} pending={pending} run={run} showRunning={showRunning} />
    </section>
  );
}
