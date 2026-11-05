import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, type Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { notifySuccess } from '../../notify.ts';
import type { SystemView } from '../../types.ts';

import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';

import { FilePath } from '../FilePath.tsx';

/** How often the state is read while the group is open. */
export const SYSTEM_POLL_MS = 3000;
/** How often and for how long the page waits for a restarted, stopped or started part. */
export const RESTART_POLL_MS = 1000;
export const RESTART_WAIT_MS = 30_000;

type Action = 'webRestart' | 'daemonRestart' | 'daemonStop' | 'daemonStart';

/** Translation keys of an action: its question, its result and its timeout. */
const TEXT = {
  webRestart: {
    title: 'system.web.restartTitle',
    description: 'system.web.restartDescription',
    confirm: 'system.restart',
    done: 'system.web.restarted',
    notBack: 'system.web.notBack',
  },
  daemonRestart: {
    title: 'system.daemon.restartTitle',
    description: 'system.daemon.restartDescription',
    confirm: 'system.restart',
    done: 'system.daemon.restarted',
    notBack: 'system.daemon.notBack',
  },
  daemonStop: {
    title: 'system.daemon.stopTitle',
    description: 'system.daemon.stopDescription',
    confirm: 'system.daemon.stop',
    done: 'system.daemon.stopped',
    notBack: 'system.daemon.notStopped',
  },
  daemonStart: { done: 'system.daemon.started', notBack: 'system.daemon.notStarted' },
} as const;

/** Whether the system reached the state the action leads to. */
function reached(action: Action, next: SystemView, pidBefore: number | null): boolean {
  switch (action) {
    case 'webRestart':
      return true;
    case 'daemonRestart':
      return next.daemon.pid !== null && next.daemon.pid !== pidBefore;
    case 'daemonStop':
      return !next.daemon.running;
    case 'daemonStart':
      return next.daemon.running && next.web.servedBy === 'daemon';
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** State of the daemon and of the panel, their restarts, and stopping and starting the daemon. */
export function SystemGroup({ api, onRestarted }: { api: Api; onRestarted: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [view, setView] = useState<SystemView | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  const latest = useRef<SystemView | null>(null);
  latest.current = view;

  useEffect(() => {
    alive.current = true;
    const read = async () => {
      try {
        const next = await api.system();
        if (!alive.current) return;
        setView(next);
        setOffline(false);
      } catch {
        if (alive.current) setOffline(true);
      }
    };
    void read();
    const timer = setInterval(() => void read(), SYSTEM_POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [api]);

  /** Waits until the panel answers with the state the action leads to. */
  const waitFor = useCallback(
    async (action: Action, pidBefore: number | null): Promise<boolean> => {
      for (let waited = 0; waited < RESTART_WAIT_MS && alive.current; waited += RESTART_POLL_MS) {
        await sleep(RESTART_POLL_MS);
        if (!alive.current) return false;
        try {
          const next = await api.system();
          if (!alive.current) return false;
          if (reached(action, next, pidBefore)) {
            setView(next);
            setOffline(false);
            return true;
          }
        } catch {
          // the panel is still coming up
        }
      }
      return false;
    },
    [api],
  );

  const send = (action: Action, force: boolean): Promise<void> => {
    switch (action) {
      case 'webRestart':
        return api.restartWeb();
      case 'daemonRestart':
        return api.restartDaemon(force);
      case 'daemonStop':
        return api.stopDaemon(force);
      case 'daemonStart':
        return api.startDaemon();
    }
  };

  const run = async (action: Action) => {
    const pidBefore = latest.current?.daemon.pid ?? null;
    const text = TEXT[action];
    if ('title' in text) {
      const ask = await confirm({
        title: t(text.title),
        description: t(text.description),
        confirmLabel: t(text.confirm),
        cancelLabel: t('system.cancel'),
        destructive: action === 'daemonStop',
      });
      if (!ask) return;
    }
    setFailure(null);
    let force = false;
    for (;;) {
      try {
        await send(action, force);
        break;
      } catch (error) {
        if (
          (action === 'daemonRestart' || action === 'daemonStop') &&
          !force &&
          error instanceof ApiError &&
          error.code === 'daemon_busy'
        ) {
          const stop = action === 'daemonStop';
          const agree = await confirm({
            title: t('system.daemon.busyTitle'),
            description: t(
              stop ? 'system.daemon.busyStopDescription' : 'system.daemon.busyDescription',
            ),
            confirmLabel: t(stop ? 'system.daemon.stopForce' : 'system.daemon.restartForce'),
            cancelLabel: t('system.cancel'),
            destructive: true,
          });
          if (!agree) return;
          force = true;
          continue;
        }
        setFailure(
          error instanceof ApiError && error.code === 'web_standalone'
            ? t('system.standaloneRefused')
            : (error as Error).message,
        );
        return;
      }
    }
    setPending(action);
    const done = await waitFor(action, pidBefore);
    if (!alive.current) return;
    setPending(null);
    if (done) {
      notifySuccess(t(text.done));
      if (action !== 'daemonStop') onRestarted();
    } else {
      setFailure(t(text.notBack, { log: latest.current?.logPath ?? 'daemon.log' }));
    }
  };

  if (!view) {
    return offline ? (
      <Alert variant="destructive">{t('system.offline')}</Alert>
    ) : (
      <div role="status" aria-label={t('system.loading')}>
        <Skeleton className="h-32" />
      </div>
    );
  }
  const { daemon, web } = view;
  const standalone = web.servedBy === 'standalone';
  const standby = web.servedBy === 'standby';
  // The pending button stays in place while the regular poll sees the daemon go down or come up.
  const showRunning =
    pending === 'daemonRestart' || pending === 'daemonStop'
      ? true
      : pending === 'daemonStart'
        ? false
        : daemon.running;
  return (
    <div className="flex flex-col gap-3" aria-label={t('system.label')} role="region">
      {offline ? <Alert variant="warn">{t('system.offline')}</Alert> : null}
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {daemon.mismatch ? (
        <Alert variant="warn">
          {t(daemon.mismatch === 'daemon' ? 'system.mismatchDaemon' : 'system.mismatchPanel')}
        </Alert>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
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
          <div className="flex flex-wrap gap-2">
            {showRunning ? (
              <>
                <Button
                  variant="outline"
                  disabled={pending !== null || standalone}
                  onClick={() => void run('daemonRestart')}
                >
                  {pending === 'daemonRestart'
                    ? t('system.restarting')
                    : t('system.daemon.restart')}
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
        </section>
        <section
          aria-label={t('system.web.title')}
          className="flex flex-col gap-2 rounded-xl border bg-card p-3"
        >
          <h3 className="font-semibold">{t('system.web.title')}</h3>
          <dl className="flex flex-col gap-1 text-sm">
            <Row label={t('system.state')}>{t('system.running')}</Row>
            <Row label="pid">{web.pid}</Row>
            <Row label={t('system.address')}>
              <code>{web.url}</code>
            </Row>
            <Row label={t('system.auth')}>{web.auth}</Row>
            <Row label={t('system.version')}>{web.version}</Row>
            <Row label={t('system.build')}>
              <code>{web.build}</code>
            </Row>
          </dl>
          {standalone ? (
            <p className="text-xs text-muted-foreground">{t('system.standalone')}</p>
          ) : null}
          <div>
            <Button
              variant="outline"
              disabled={pending !== null || standalone || standby}
              onClick={() => void run('webRestart')}
            >
              {pending === 'webRestart' ? t('system.restarting') : t('system.web.restart')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
