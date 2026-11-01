import type { TFunction } from 'i18next';

import type { DiffTotals, RunView } from './types.ts';

export function duration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function cost(usage: { costUsd: number | null } | null | undefined): string {
  if (!usage || usage.costUsd === null) return '';
  return `$${usage.costUsd.toFixed(2)}`;
}

export function tokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
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

/** When a run started and how long it took; only an active run shows a running clock. */
export function runTime(
  run: { createdAt: number; finishedAt: number | null; finished: boolean },
  now: number,
  t: TFunction,
  locale: string,
): string {
  if (run.finished && run.finishedAt !== null) {
    return `${when(run.createdAt, now, locale)} · ${duration(run.finishedAt - run.createdAt)}`;
  }
  return t('format.running', { duration: duration(now - run.createdAt) });
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
