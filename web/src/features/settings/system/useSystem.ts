import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, type Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { SystemView } from '../../../shared/api/types.ts';
import {
  RESTART_POLL_MS,
  RESTART_WAIT_MS,
  SYSTEM_POLL_MS,
  TEXT,
  isBusy,
  reached,
  send,
  sleep,
  type Action,
} from './actions.ts';

/** The state of the system read on a timer, and the wait for the state an action leads to. */
function useSystemView(api: Api) {
  const [view, setView] = useState<SystemView | null>(null);
  const [offline, setOffline] = useState(false);
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
  return { view, offline, alive, latest, waitFor };
}

/** The state of the daemon and of the panel, read on a timer, and the actions on them. */
export function useSystem(api: Api, onRestarted: () => void) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [pending, setPending] = useState<Action | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { view, offline, alive, latest, waitFor } = useSystemView(api);

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
        await send(api, action, force);
        break;
      } catch (error) {
        if (isBusy(action, force, error)) {
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
  return { view, offline, pending, failure, run };
}
