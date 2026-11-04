import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  GitMerge,
  Hourglass,
  Loader2,
  MessageCircleQuestion,
  PackageCheck,
  PackageX,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { TFunction } from 'i18next';

import { clock } from './format.ts';
import type { GroupWait } from './types.ts';
import type { en } from './i18n/locales/en.ts';
import type { Connection } from './store.ts';

export type Tone = 'run' | 'warn' | 'err' | 'ok' | 'mute';

type StatusKey = keyof typeof en.status;

interface StatusEntry {
  labelKey: StatusKey;
  tone: Tone;
  icon: LucideIcon;
  /** The icon rotates: the status is in progress. */
  spin: boolean;
}

export interface StatusInfo {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** The icon rotates: the status is in progress. */
  spin: boolean;
}

/** Every status the panel shows: the key of its label in the dictionaries, tone and icon. */
export const STATUS: Record<string, StatusEntry> = {
  queued: { labelKey: 'queued', tone: 'mute', icon: CircleDashed, spin: false },
  waiting: { labelKey: 'waiting', tone: 'mute', icon: Hourglass, spin: false },
  running: { labelKey: 'running', tone: 'run', icon: Loader2, spin: true },
  merging: { labelKey: 'merging', tone: 'run', icon: GitMerge, spin: false },
  active: { labelKey: 'active', tone: 'run', icon: Loader2, spin: true },
  needs_human: { labelKey: 'needs_human', tone: 'warn', icon: MessageCircleQuestion, spin: false },
  conflict: { labelKey: 'conflict', tone: 'warn', icon: AlertTriangle, spin: false },
  apply_failed: { labelKey: 'apply_failed', tone: 'warn', icon: PackageX, spin: false },
  rejected: { labelKey: 'rejected', tone: 'warn', icon: AlertTriangle, spin: false },
  failed: { labelKey: 'failed', tone: 'err', icon: XCircle, spin: false },
  merged: { labelKey: 'merged', tone: 'ok', icon: GitMerge, spin: false },
  applied: { labelKey: 'applied', tone: 'ok', icon: PackageCheck, spin: false },
  done: { labelKey: 'done', tone: 'ok', icon: CheckCircle2, spin: false },
  finished: { labelKey: 'finished', tone: 'ok', icon: CheckCircle2, spin: false },
  cancelled: { labelKey: 'cancelled', tone: 'mute', icon: Ban, spin: false },
  pending: { labelKey: 'pending', tone: 'mute', icon: Circle, spin: false },
  paused: { labelKey: 'paused', tone: 'warn', icon: PauseCircle, spin: false },
  stopped: { labelKey: 'stopped', tone: 'mute', icon: PauseCircle, spin: false },
  warnings: { labelKey: 'warnings', tone: 'warn', icon: AlertTriangle, spin: false },
};

/** Status by its code with the label in the active language; an unknown code is shown as it is. */
export function statusInfo(code: string, t: TFunction): StatusInfo {
  const entry = STATUS[code];
  if (!entry) return { label: code, tone: 'mute', icon: Circle, spin: false };
  return {
    label: t(`status.${entry.labelKey}`),
    tone: entry.tone,
    icon: entry.icon,
    spin: entry.spin,
  };
}

/** Why a group waits, for people: the busy specialist, the full swarm or the usage limit. */
export function waitText(wait: GroupWait, t: TFunction): string {
  switch (wait.reason) {
    case 'specialist':
      return t('wait.specialist', { specialist: wait.name ?? wait.specialist, max: wait.max });
    case 'capacity':
      return t('wait.capacity', { max: wait.max });
    case 'limit':
      return t('wait.limit', { runtime: wait.runtime, time: clock(wait.until) });
  }
}

export function statusTone(code: string): Tone {
  return STATUS[code]?.tone ?? 'mute';
}

/** Label of a run: «Needs answer ×N» when several groups wait for an answer. */
export function runStatusLabel(run: { state: string; waiting: number }, t: TFunction): string {
  const { label } = statusInfo(run.state, t);
  return run.state === 'needs_human' && run.waiting >= 2 ? `${label} ×${run.waiting}` : label;
}

export function connectionLabel(connection: Connection, t: TFunction): string {
  return t(`connection.${connection}`);
}

export function queueStateLabel(status: 'running' | 'stopped', t: TFunction): string {
  return t(`queueState.${status}`);
}
