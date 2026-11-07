import i18next from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isRepairing } from '../shared/api/observerTypes.ts';
import { usePreference } from '../shared/lib/browser/preferences.ts';
import { statusInfo, type Tone } from '../shared/lib/status.ts';
import type { RunView } from '../shared/api/types.ts';

/** What a notification is about: the status that waits for a person. */
export type NotificationKind = 'needs_human' | 'failed' | 'conflict' | 'apply_failed';

const KIND_ORDER: readonly NotificationKind[] = [
  'needs_human',
  'failed',
  'conflict',
  'apply_failed',
];

export interface NotificationItem {
  /** `<run>/<group>/<kind>`: the same while the group stays in the state. */
  key: string;
  kind: NotificationKind;
  runId: string;
  runTitle: string;
  repository: string;
  slug: string;
  groupTitle: string;
  /** The first line of the question or of the reason; empty when there is none. */
  detail: string;
  /** The question is for a person only; null otherwise. */
  humanOnly: 'review' | 'request' | null;
  createdAt: number;
}

function firstLine(text: string | null): string {
  return (
    (text ?? '')
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  );
}

/** The kinds of notification a group raises: the states that wait for a person. */
function groupKinds(group: RunView['groups'][number]): NotificationKind[] {
  const kinds: NotificationKind[] = [];
  if (group.status === 'needs_human' || group.status === 'failed' || group.status === 'conflict')
    kinds.push(group.status);
  if (group.delivery === 'apply_failed') kinds.push('apply_failed');
  return kinds;
}

/** Groups of all runs that wait for a person, in the order the list shows them. */
export function notificationItems(runs: readonly RunView[]): NotificationItem[] {
  const items: { item: NotificationItem; order: number; position: number }[] = [];
  for (const run of runs) {
    // an observer works on the task: its incidents are not for a person
    if (isRepairing(run)) continue;
    run.groups.forEach((group, index) => {
      for (const kind of groupKinds(group)) {
        const text = kind === 'needs_human' ? group.question : group.reason;
        items.push({
          item: {
            key: `${run.id}/${group.slug}/${kind}`,
            kind,
            runId: run.id,
            runTitle: run.title || run.name || run.id,
            repository: run.repository,
            slug: group.slug,
            groupTitle: group.title,
            detail: firstLine(text),
            humanOnly: kind === 'needs_human' ? (group.humanOnly ?? null) : null,
            createdAt: run.createdAt,
          },
          order: KIND_ORDER.indexOf(kind),
          position: index,
        });
      }
    });
  }
  return items
    .sort(
      (a, b) => a.order - b.order || b.item.createdAt - a.item.createdAt || a.position - b.position,
    )
    .map(({ item }) => item);
}

/** The keys of all groups in a state of notification, including runs an observer repairs. */
export function stateKeys(runs: readonly RunView[]): Set<string> {
  const keys = new Set<string>();
  for (const run of runs) {
    for (const group of run.groups) {
      for (const kind of groupKinds(group)) keys.add(`${run.id}/${group.slug}/${kind}`);
    }
  }
  return keys;
}

/** How many marks of one kind are kept; the oldest are dropped first. */
export const MARKS_LIMIT = 1000;

/**
 * The marks that stay: a mark is dropped only when the loaded copy of its run shows the group out
 * of that state. A run the panel has not loaded says nothing, so its marks stay.
 */
export function pruneKeys(keys: readonly string[], runs: readonly RunView[]): string[] {
  const loaded = new Set(runs.map((run) => run.id));
  const inState = stateKeys(runs);
  const kept = keys.filter((key) => {
    const runId = key.slice(0, Math.max(key.indexOf('/'), 0));
    return !loaded.has(runId) || inState.has(key);
  });
  return kept.length > MARKS_LIMIT ? kept.slice(-MARKS_LIMIT) : kept;
}

export type BrowserPermission = 'default' | 'granted' | 'denied' | 'unsupported';

/** The permission of the browser to show system notifications. */
export function readPermission(): BrowserPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'unsupported';
  const permission = Notification.permission as string;
  return permission === 'granted' || permission === 'denied' ? permission : 'default';
}

export interface NotificationCenterState {
  items: NotificationItem[];
  /** Items not yet seen in the open list. */
  unread: number;
  /** `warn` while an unread item waits for an answer, otherwise `err`. */
  unreadTone: Tone;
  isRead: (item: NotificationItem) => boolean;
  permission: BrowserPermission;
  /** The list opened: everything shown counts as read, the permission is read again. */
  open: () => void;
  /** Asks the browser for the permission. */
  enable: () => void;
  hide: (key: string) => void;
  hideAll: () => void;
  select: (item: NotificationItem) => void;
}

/** System notifications: only for items that appeared after the first state. */
function useSystemNotifications(
  all: NotificationItem[],
  ready: boolean,
  hiddenSet: ReadonlySet<string>,
  listedRuns: ReadonlySet<string> | null,
  onOpenGroup: (item: NotificationItem) => void,
): void {
  const known = useRef<Set<string> | null>(null);
  const latest = useRef(onOpenGroup);
  latest.current = onOpenGroup;
  const listedRef = useRef(listedRuns);
  listedRef.current = listedRuns;
  const hiddenRef = useRef(hiddenSet);
  hiddenRef.current = hiddenSet;
  useEffect(() => {
    if (!ready) return;
    const before = known.current;
    known.current = new Set(all.map((item) => item.key));
    if (before === null || readPermission() !== 'granted') return;
    for (const item of all) {
      if (before.has(item.key)) continue;
      // a live hide mark means the panel saw no exit from the state (e.g. a repair ended)
      if (hiddenRef.current.has(item.key)) continue;
      // a run loaded page by page or by id is not a transition
      if (listedRef.current !== null && !listedRef.current.has(item.runId)) continue;
      const base = statusInfo(item.kind, i18next.t).label;
      const label = item.humanOnly
        ? `${base} · ${i18next.t(`runs.humanOnly.${item.humanOnly}`)}`
        : base;
      const notification = new Notification(`aip: ${item.groupTitle}`, {
        body: item.detail ? `${label} · ${item.detail}` : label,
        tag: item.key,
      });
      notification.onclick = () => {
        window.focus();
        latest.current(item);
        notification.close();
      };
    }
  }, [ready, all]);
}

/**
 * The notification centre: the items derived from the runs, which of them are read or hidden
 * (kept in the browser), the browser permission and the system notifications of new items.
 * `ready` is false until the first state of the runs has arrived, so a reload neither forgets
 * the marks nor announces what was already there. `listedRuns` names the runs of the live list
 * (null: all); only they raise system notifications.
 */
export function useNotificationCenter(
  runs: readonly RunView[],
  onOpenGroup: (item: NotificationItem) => void,
  ready = true,
  listedRuns: ReadonlySet<string> | null = null,
): NotificationCenterState {
  const [read, setRead] = usePreference<string[]>('notificationsRead', [], { shared: true });
  const [hidden, setHidden] = usePreference<string[]>('notificationsHidden', [], { shared: true });
  const [permission, setPermission] = useState<BrowserPermission>(readPermission);
  const all = useMemo(() => notificationItems(runs), [runs]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const readSet = useMemo(() => new Set(read), [read]);
  const items = useMemo(() => all.filter((item) => !hiddenSet.has(item.key)), [all, hiddenSet]);
  const unreadItems = items.filter((item) => !readSet.has(item.key));

  // A group that left its state and came back is a new notification.
  useEffect(() => {
    if (!ready) return;
    const nextRead = pruneKeys(read, runs);
    if (nextRead.length !== read.length) setRead(nextRead);
    const nextHidden = pruneKeys(hidden, runs);
    if (nextHidden.length !== hidden.length) setHidden(nextHidden);
  }, [ready, runs, read, hidden, setRead, setHidden]);

  useSystemNotifications(all, ready, hiddenSet, listedRuns, onOpenGroup);

  const open = useCallback(() => {
    setPermission(readPermission());
    const keys = [...new Set([...read, ...items.map((item) => item.key)])];
    if (keys.length !== read.length) setRead(keys);
  }, [read, items, setRead]);
  const enable = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then(
      () => setPermission(readPermission()),
      () => setPermission(readPermission()),
    );
  }, []);
  const hide = useCallback(
    (key: string) => setHidden([...new Set([...hidden, key])]),
    [hidden, setHidden],
  );
  const hideAll = useCallback(
    () => setHidden([...new Set([...hidden, ...items.map((item) => item.key)])]),
    [hidden, items, setHidden],
  );
  const isRead = useCallback((item: NotificationItem) => readSet.has(item.key), [readSet]);

  return {
    items,
    unread: unreadItems.length,
    unreadTone: unreadItems.some((item) => item.kind === 'needs_human') ? 'warn' : 'err',
    isRead,
    permission,
    open,
    enable,
    hide,
    hideAll,
    select: onOpenGroup,
  };
}
