import type { TFunction } from 'i18next';

import type { DiffTotals, RunView } from './types.ts';

/** `#7`: how a task number is shown. */
export function taskNumber(number: number): string {
  return `#${number}`;
}

export function duration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function cost(usage: { costUsd: number | null } | null | undefined): string {
  if (!usage || usage.costUsd === null || usage.costUsd === 0) return '';
  return `$${usage.costUsd.toFixed(2)}`;
}

export function tokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** Tokens of a usage as `in/out` (`12.3k/1.1k`); empty without usage. */
export function usageText(
  usage: { inputTokens: number; outputTokens: number } | null | undefined,
): string {
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return '';
  return `${tokens(usage.inputTokens)}/${tokens(usage.outputTokens)}`;
}

export function files(count: number, t: TFunction): string {
  return t('format.files', { count });
}

export function diffText(diff: DiffTotals | null | undefined, t: TFunction): string {
  if (!diff) return '';
  return `${files(diff.files, t)} +${diff.added} −${diff.removed}`;
}

export function runTitle(run: RunView): string {
  return run.title || run.groups.map((group) => group.title).join(', ') || run.id;
}

/** Clock time of a moment in the given locale: `14:32` today, with the day on another day. */
export function when(timestamp: number, now: number, locale: string): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  const day = date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return `${day} ${time}`;
}

/** Percent (0–100) of the steps a run has passed; 0 while the task is split. */
export function progressPercent(progress: { done: number; total: number }): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)));
}

/**
 * Where the clock of a run ends: `finishedAt` when finished, the stop of a held run's clock
 * when it has one, else `now`.
 */
export function runClockEnd(
  run: {
    finishedAt: number | null;
    finished: boolean;
    clockStoppedAt?: number | null;
  },
  now: number,
): number {
  if (run.finished && run.finishedAt !== null) return run.finishedAt;
  return run.clockStoppedAt ?? now;
}

/** When a run was created and how long it has taken, by `runClockEnd`. */
export function runTimes(
  run: {
    createdAt: number;
    finishedAt: number | null;
    finished: boolean;
    clockStoppedAt?: number | null;
  },
  now: number,
  locale: string,
): { created: string; duration: string } {
  const end = runClockEnd(run, now);
  return { created: when(run.createdAt, now, locale), duration: duration(end - run.createdAt) };
}

/** One question of a specialist, as the panel receives it. */
export interface AskedQuestion {
  text: string;
  options?: string[] | null;
  recommendation?: string | null;
}

/** The answer sent to the specialist: `Q1: …` / `A1: …` for every question, a blank line between. */
export function answerText(
  questions: readonly AskedQuestion[],
  answers: readonly string[],
): string {
  return questions
    .map(
      (question, index) =>
        `Q${index + 1}: ${question.text}\nA${index + 1}: ${(answers[index] ?? '').trim()}`,
    )
    .join('\n\n');
}

/** The key of the draft of one question: changes when the text of the question changes. */
export function questionKey(prefix: string, index: number, text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}/q${index}/${hash.toString(16).padStart(8, '0')}`;
}

/** Local `HH:MM` of a moment. */
export function clock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A group failure reason for people; a usage limit is translated, other reasons stay as they are. */
export function reasonLabel(reason: string, t: TFunction): string {
  if (reason === 'step skipped') return t('runs.group.skippedReason');
  const limit = /^usage limit(?:, resets (\d\d:\d\d))?$/.exec(reason);
  if (!limit) return reason;
  return limit[1] ? t('runs.group.limitReasonAt', { time: limit[1] }) : t('runs.group.limitReason');
}

/** Uptime of a process: `45 s`, `2 min 5 s`, `3 h 2 min`. */
export function formatUptime(seconds: number, t: TFunction): string {
  const total = Math.max(0, Math.floor(seconds));
  const sec = t('format.unitSec');
  const min = t('format.unitMin');
  if (total < 60) return `${total} ${sec}`;
  if (total < 3600) return `${Math.floor(total / 60)} ${min} ${total % 60} ${sec}`;
  return `${Math.floor(total / 3600)} ${t('format.unitHour')} ${Math.floor((total % 3600) / 60)} ${min}`;
}

/** Average CPU of a process in percent of one core, with one decimal in the language's style. */
export function formatCpu(percent: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(percent)} %`;
}

/** Resident memory in KB, MB or GB (1024-based). */
export function formatMemory(bytes: number, t: TFunction, locale: string): string {
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  if (bytes >= 1024 ** 3) return `${number(bytes / 1024 ** 3, 1)} ${t('format.unitGb')}`;
  if (bytes >= 1024 ** 2) return `${number(bytes / 1024 ** 2, 0)} ${t('format.unitMb')}`;
  return `${number(bytes / 1024, 0)} ${t('format.unitKb')}`;
}

/** Size of a file: bytes, KB or MB with one decimal (1024-based), in the language of the panel. */
export function formatBytes(bytes: number, t: TFunction, locale: string): string {
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  if (bytes >= 1024 ** 2) return `${number(bytes / 1024 ** 2)} ${t('format.unitMb')}`;
  if (bytes >= 1024) return `${number(bytes / 1024)} ${t('format.unitKb')}`;
  return `${bytes} ${t('format.unitB')}`;
}

/** `14:32:05`: clock time with seconds, for a line of a log. */
export function clockSeconds(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** Full date and time of a moment in the given language, for a tooltip. */
export function dateTime(timestamp: number, language: string): string {
  return new Date(timestamp).toLocaleString(language);
}
