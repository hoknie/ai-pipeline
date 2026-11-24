import type { LessonSummaryView } from '../../ipc/contract/index.ts';
import { type Style, plainStyle } from '../style.ts';
import { taskNumber } from '../table.ts';

const VERDICTS = ['done', 'rejected', 'needs_human', 'failed'] as const;

/** The verdicts of a specialist that saw at least one attempt, e.g. `done 3, rejected 2`. */
function verdictsText(verdicts: LessonSummaryView['specialists'][number]['verdicts']): string {
  return VERDICTS.filter((verdict) => verdicts[verdict] > 0)
    .map((verdict) => `${verdict} ${verdicts[verdict]}`)
    .join(', ');
}

/** The evidence of one lesson: how often, on which tasks and when last. */
function evidenceText(lesson: LessonSummaryView['specialists'][number]['lessons'][number]): string {
  const tasks = lesson.evidence.tasks.slice(0, 5).map(taskNumber);
  const rest = lesson.evidence.tasks.length - tasks.length;
  const list = tasks.length === 0 ? 'no tasks' : tasks.join(', ');
  const seen =
    lesson.evidence.seenAt > 0
      ? new Date(lesson.evidence.seenAt).toISOString().slice(0, 10)
      : 'unknown';
  const occurrences =
    lesson.evidence.occurrences === 1 ? 'once' : `${lesson.evidence.occurrences} times`;
  return `${occurrences} (${list}${rest > 0 ? `, +${rest} more` : ''}; last seen ${seen})`;
}

function specialistLines(
  specialist: LessonSummaryView['specialists'][number],
  style: Style,
): string[] {
  const counts = verdictsText(specialist.verdicts);
  const head = `${style.accent(specialist.specialist)}: ${specialist.attempts} attempt(s)${counts ? ` (${counts})` : ''}`;
  if (specialist.lessons.length === 0) return [`${head} · no lessons yet`];
  const lines = [
    `${head} · ${specialist.lessons.length} lesson(s)${specialist.dropped > 0 ? `, ${specialist.dropped} dropped by the limit` : ''}`,
  ];
  for (const lesson of specialist.lessons) {
    lines.push(`  - ${lesson.text} ${style.muted(`[${evidenceText(lesson)}]`)}`);
  }
  return lines;
}

/** The lessons a finished run leaves to the next attempts of its repository. */
export function formatLessons(summary: LessonSummaryView, style: Style = plainStyle): string {
  const head = `Lessons of run ${style.accent(summary.runId)} (${summary.repository})`;
  if (summary.specialists.length === 0) return `${head}\nNo specialists took part in this run.`;
  const lines = [head];
  for (const specialist of summary.specialists) {
    lines.push(...specialistLines(specialist, style));
  }
  return lines.join('\n');
}
