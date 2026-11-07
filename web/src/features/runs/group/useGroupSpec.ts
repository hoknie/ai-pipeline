import { useEffect, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { GroupSpecView } from '../../../shared/api/types.ts';

/** Interval of the requests for the change documents while a group works and they are shown. */
export const SPEC_POLL_MS = 5000;

const same = (a: GroupSpecView | null, b: GroupSpecView | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.change === b.change &&
    a.path === b.path &&
    a.design === b.design &&
    a.tasks === b.tasks);

/**
 * The OpenSpec change documents of a group: requested on mount and whenever `version` changes,
 * and every `SPEC_POLL_MS` while `poll` holds. `undefined` until the first answer.
 */
export function useGroupSpec(
  api: Api,
  runId: string,
  group: string,
  version: string,
  poll: boolean,
  onError: (message: string) => void,
  enabled = true,
): GroupSpecView | null | undefined {
  const [spec, setSpec] = useState<GroupSpecView | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const load = (quiet: boolean) =>
      api.groupSpec(runId, group).then(
        (next) => {
          if (!stopped)
            setSpec((before) => (before !== undefined && same(before, next) ? before : next));
        },
        (failure: Error) => {
          if (stopped || quiet) return;
          setSpec((before) => (before === undefined ? null : before));
          onError(failure.message);
        },
      );
    void load(false);
    const timer = poll ? setInterval(() => void load(true), SPEC_POLL_MS) : null;
    return () => {
      stopped = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [api, runId, group, version, poll, enabled, onError]);

  return spec;
}
