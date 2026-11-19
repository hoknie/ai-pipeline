import { useEffect, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import { liveTopics } from '../../../shared/api/live/topics.ts';
import type { GroupSpecView } from '../../../shared/api/types.ts';

const same = (a: GroupSpecView | null, b: GroupSpecView | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.change === b.change &&
    a.path === b.path &&
    a.design === b.design &&
    a.tasks === b.tasks);

/**
 * The OpenSpec change documents of a group: sent on mount and whenever the run changes, and with
 * `watch` also while the log of the group grows. `undefined` until the first answer. Only the
 * first failure is told: after it the last text stays.
 */
export function useGroupSpec(
  api: Api,
  runId: string,
  group: string,
  watch: boolean,
  onError: (message: string) => void,
  enabled = true,
): GroupSpecView | null | undefined {
  const [spec, setSpec] = useState<GroupSpecView | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let answered = false;
    const topic = { kind: 'group_spec' as const, runId, group, ...(watch ? { watch } : {}) };
    return liveTopics.watch(
      api,
      topic,
      (next) => {
        answered = true;
        setSpec((before) => (before !== undefined && same(before, next) ? before : next));
      },
      (message) => {
        if (answered) return;
        answered = true;
        setSpec((before) => (before === undefined ? null : before));
        onError(message);
      },
    );
  }, [api, runId, group, watch, enabled, onError]);

  return spec;
}
