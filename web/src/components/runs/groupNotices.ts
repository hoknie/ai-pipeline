import { useCallback } from 'react';

import { usePreference } from '../../preferences.ts';
import type { AttemptView, GroupRow, GroupView } from '../../types.ts';

/** Groups whose closed notice is remembered in the browser. */
export const DISMISSED_LIMIT = 200;

/** A notice between the header of a group and its tabs. */
export type GroupNotice =
  | { kind: 'warning'; key: string; text: string }
  | { kind: 'outside'; key: string; attempt: AttemptView }
  | { kind: 'hints'; key: string; patterns: string[] }
  | { kind: 'reason'; key: string; text: string };

/**
 * Notices of a group from the oldest to the newest: warnings in the order they came, the
 * outside changes of attempts by number, the permissions hint, the reason of a failure.
 */
export function groupNotices(view: GroupView | null, row: GroupRow): GroupNotice[] {
  const notices: GroupNotice[] = [];
  (view?.warnings ?? []).forEach((text, index) =>
    notices.push({ kind: 'warning', key: `warning:${index}:${text}`, text }),
  );
  const attempts = [...(view?.attempts ?? [])].sort((a, b) => a.seq - b.seq);
  for (const attempt of attempts)
    if ((attempt.outsideChanges ?? []).length > 0)
      notices.push({ kind: 'outside', key: `outside:${attempt.seq}`, attempt });
  const patterns = view?.permissionHints ?? [];
  if (patterns.length > 0)
    notices.push({ kind: 'hints', key: `hints:${patterns.join(',')}`, patterns });
  if (row.reason && row.status !== 'needs_human')
    notices.push({ kind: 'reason', key: `reason:${row.reason}`, text: row.reason });
  return notices;
}

/** The last notice, unless it is the one the person closed; an older one never takes its place. */
export function latestNotice(notices: GroupNotice[], dismissed: string | null): GroupNotice | null {
  const last = notices.at(-1) ?? null;
  return last !== null && last.key !== dismissed ? last : null;
}

/** The key of the notice closed in a group, kept in the browser. */
export function useDismissedNotice(
  runId: string,
  slug: string,
): [string | null, (key: string) => void] {
  const [all, setAll] = usePreference<Record<string, string>>('dismissedNotices', {});
  const id = `${runId}/${slug}`;
  const dismiss = useCallback(
    (key: string) => {
      const { [id]: _old, ...rest } = all;
      const entries = Object.entries({ ...rest, [id]: key });
      setAll(Object.fromEntries(entries.slice(-DISMISSED_LIMIT)));
    },
    [all, id, setAll],
  );
  return [all[id] ?? null, dismiss];
}
