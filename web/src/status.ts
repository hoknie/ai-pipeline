import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  GitMerge,
  Loader2,
  MessageCircleQuestion,
  PackageCheck,
  PackageX,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { TFunction } from 'i18next';

import type { en } from './i18n/locales/en.ts';
import type { Connection } from './store.ts';

export type Tone = 'run' | 'warn' | 'err' | 'ok' | 'mute';

type StatusKey = keyof typeof en.status;

interface StatusEntry {
  labelKey: StatusKey;
  tone: Tone;
  icon: LucideIcon;
}

export interface StatusInfo {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

/** Every status the panel shows: the key of its label in the dictionaries, tone and icon. */
export const STATUS: Record<string, StatusEntry> = {
  queued: { labelKey: 'queued', tone: 'mute', icon: CircleDashed },
  running: { labelKey: 'running', tone: 'run', icon: Loader2 },
  merging: { labelKey: 'merging', tone: 'run', icon: GitMerge },
  active: { labelKey: 'active', tone: 'run', icon: Loader2 },
  needs_human: { labelKey: 'needs_human', tone: 'warn', icon: MessageCircleQuestion },
  conflict: { labelKey: 'conflict', tone: 'warn', icon: AlertTriangle },
  apply_failed: { labelKey: 'apply_failed', tone: 'warn', icon: PackageX },
  rejected: { labelKey: 'rejected', tone: 'warn', icon: AlertTriangle },
  failed: { labelKey: 'failed', tone: 'err', icon: XCircle },
  merged: { labelKey: 'merged', tone: 'ok', icon: GitMerge },
  applied: { labelKey: 'applied', tone: 'ok', icon: PackageCheck },
  done: { labelKey: 'done', tone: 'ok', icon: CheckCircle2 },
  finished: { labelKey: 'finished', tone: 'ok', icon: CheckCircle2 },
  cancelled: { labelKey: 'cancelled', tone: 'mute', icon: Ban },
  pending: { labelKey: 'pending', tone: 'mute', icon: Circle },
  stopped: { labelKey: 'stopped', tone: 'mute', icon: PauseCircle },
  warnings: { labelKey: 'warnings', tone: 'warn', icon: AlertTriangle },
};

/** Status by its code with the label in the active language; an unknown code is shown as it is. */
export function statusInfo(code: string, t: TFunction): StatusInfo {
  const entry = STATUS[code];
  if (!entry) return { label: code, tone: 'mute', icon: Circle };
  return { label: t(`status.${entry.labelKey}`), tone: entry.tone, icon: entry.icon };
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
