import i18next from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePreference } from './preferences.ts';
import { statusInfo, type Tone } from './status.ts';
import type { RunView } from './types.ts';

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

/** Groups of all runs that wait for a person, in the order the list shows them. */
export function notificationItems(runs: readonly RunView[]): NotificationItem[] {
  const items: { item: NotificationItem; order: number; position: number }[] = [];
  for (const run of runs) {
    run.groups.forEach((group, index) => {
      const kinds: NotificationKind[] = [];
      if (
        group.status === 'needs_human' ||
        group.status === 'failed' ||
        group.status === 'conflict'
      )
        kinds.push(group.status);
      if (group.delivery === 'apply_failed') kinds.push('apply_failed');
      for (const kind of kinds) {
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

/** The keys that still name a current item; marks of items that left their state are dropped. */
export function pruneKeys(keys: readonly string[], items: readonly NotificationItem[]): string[] {
  const current = new Set(items.map((item) => item.key));
  return keys.filter((key) => current.has(key));
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

/**
 * The notification centre: the items derived from the runs, which of them are read or hidden
 * (kept in the browser), the browser permission and the system notifications of new items.
 * `ready` is false until the first state of the runs has arrived, so a reload neither forgets
 * the marks nor announces what was already there.
 */
export function useNotificationCenter(
  runs: readonly RunView[],
  onOpenGroup: (item: NotificationItem) => void,
  ready = true,
): NotificationCenterState {
  const [read, setRead] = usePreference<string[]>('notificationsRead', []);
  const [hidden, setHidden] = usePreference<string[]>('notificationsHidden', []);
  const [permission, setPermission] = useState<BrowserPermission>(readPermission);
  const all = useMemo(() => notificationItems(runs), [runs]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const readSet = useMemo(() => new Set(read), [read]);
  const items = useMemo(() => all.filter((item) => !hiddenSet.has(item.key)), [all, hiddenSet]);
  const unreadItems = items.filter((item) => !readSet.has(item.key));

  // A group that left its state and came back is a new notification.
  useEffect(() => {
    if (!ready) return;
    const nextRead = pruneKeys(read, all);
    if (nextRead.length !== read.length) setRead(nextRead);
    const nextHidden = pruneKeys(hidden, all);
    if (nextHidden.length !== hidden.length) setHidden(nextHidden);
  }, [ready, all, read, hidden, setRead, setHidden]);

  // System notifications: only for items that appeared after the first state.
  const known = useRef<Set<string> | null>(null);
  const latest = useRef(onOpenGroup);
  latest.current = onOpenGroup;
  useEffect(() => {
    if (!ready) return;
    const before = known.current;
    known.current = new Set(all.map((item) => item.key));
    if (before === null || readPermission() !== 'granted') return;
    for (const item of all) {
      if (before.has(item.key)) continue;
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
