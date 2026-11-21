import { useCallback, useEffect, useRef, useState } from 'react';

import type { Api, IntegrationsOverview } from '../../shared/api/api.ts';

import { messageOf } from './events.ts';

/** How often the page asks again: the state of channels and the journal change by themselves. */
export const POLL_MS = 5000;

export interface IntegrationsState {
  overview: IntegrationsOverview | null;
  /** The last failure of loading or of an action; null when everything went through. */
  error: string | null;
  /** The refusal of the last action (a new connection, a switch): stays until closed or the next action. */
  actionError: string | null;
  dismissActionError: () => void;
  loading: boolean;
  reload: () => void;
  /** Runs a change, then loads again; a failure goes to `error`. Returns whether it went through. */
  act: <T>(change: () => Promise<T>) => Promise<boolean>;
}

/** The connections, subscriptions and channels of the daemon, kept fresh while the page is open. */
export function useIntegrations(api: Api): IntegrationsState {
  const [overview, setOverview] = useState<IntegrationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const id = latest.current;
    return api
      .integrations()
      .then((next) => {
        if (id !== latest.current) return;
        setOverview(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (id === latest.current) setError(messageOf(failure));
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [api]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
      latest.current += 1;
    };
  }, [load]);

  const act = useCallback(
    async <T>(change: () => Promise<T>): Promise<boolean> => {
      setActionError(null);
      try {
        await change();
      } catch (failure) {
        setActionError(messageOf(failure));
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  return {
    overview,
    error,
    actionError,
    dismissActionError: () => setActionError(null),
    loading,
    reload: () => void load(),
    act,
  };
}
