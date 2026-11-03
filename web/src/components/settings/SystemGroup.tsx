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
/** How often and for how long the page waits for a restarted part to answer. */
export const RESTART_POLL_MS = 1000;
export const RESTART_WAIT_MS = 30_000;

type Part = 'web' | 'daemon';

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

/** State of the daemon and of the panel, and their restarts. */
export function SystemGroup({ api, onRestarted }: { api: Api; onRestarted: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [view, setView] = useState<SystemView | null>(null);
  const [offline, setOffline] = useState(false);
  const [restarting, setRestarting] = useState<Part | null>(null);
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

  /** Waits until the restarted part answers: the panel by any answer, the daemon by a new pid. */
  const waitBack = useCallback(
    async (part: Part, pidBefore: number | null): Promise<boolean> => {
      for (let waited = 0; waited < RESTART_WAIT_MS && alive.current; waited += RESTART_POLL_MS) {
        await sleep(RESTART_POLL_MS);
        if (!alive.current) return false;
        try {
          const next = await api.system();
          if (!alive.current) return false;
          if (part === 'web' || (next.daemon.pid !== null && next.daemon.pid !== pidBefore)) {
            setView(next);
            setOffline(false);
            return true;
          }
        } catch {
          // the part is still coming up
        }
      }
      return false;
    },
    [api],
  );

  const restart = async (part: Part) => {
    const pidBefore = latest.current?.daemon.pid ?? null;
    const ask = await confirm({
      title: t(part === 'web' ? 'system.web.restartTitle' : 'system.daemon.restartTitle'),
      description: t(
        part === 'web' ? 'system.web.restartDescription' : 'system.daemon.restartDescription',
      ),
      confirmLabel: t('system.restart'),
      cancelLabel: t('system.cancel'),
    });
    if (!ask) return;
    setFailure(null);
    let force = false;
    for (;;) {
      try {
        if (part === 'web') await api.restartWeb();
        else await api.restartDaemon(force);
        break;
      } catch (error) {
        if (
          part === 'daemon' &&
          !force &&
          error instanceof ApiError &&
          error.code === 'daemon_busy'
        ) {
          const agree = await confirm({
            title: t('system.daemon.busyTitle'),
            description: t('system.daemon.busyDescription'),
            confirmLabel: t('system.daemon.restartForce'),
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
    setRestarting(part);
    const back = await waitBack(part, pidBefore);
    if (!alive.current) return;
    setRestarting(null);
    if (back) {
      notifySuccess(t(part === 'web' ? 'system.web.restarted' : 'system.daemon.restarted'));
      onRestarted();
    } else {
      setFailure(
        t(part === 'web' ? 'system.web.notBack' : 'system.daemon.notBack', {
          log: latest.current?.logPath ?? 'daemon.log',
        }),
      );
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
          <div>
            <Button
              variant="outline"
              disabled={restarting !== null || standalone}
              onClick={() => void restart('daemon')}
            >
              {restarting === 'daemon' ? t('system.restarting') : t('system.daemon.restart')}
            </Button>
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
              disabled={restarting !== null || standalone}
              onClick={() => void restart('web')}
            >
              {restarting === 'web' ? t('system.restarting') : t('system.web.restart')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
