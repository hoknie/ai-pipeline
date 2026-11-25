import type { DeliverySignal, DenialSignal, FileCount, OutsideSignal } from './signal.ts';
import type { SpecialistSignal } from './signal.ts';

/** The most characters of lessons a prompt gets; longer lists are dropped by priority, never cut. */
export const LESSON_BLOCK_LIMIT = 4000;

/** The most lessons a prompt gets, by priority. */
export const LESSON_COUNT_LIMIT = 12;

/**
 * The most characters of one lessons file, archive included. The archive is trimmed oldest first,
 * so the file stays a readable artifact a person can open without a pager.
 */
export const LESSON_FILE_LIMIT = 12_000;

/**
 * The least evidence that makes a lesson: at least one observed outcome. A rule without an
 * occurrence behind it would be a guess, and a guess is never a lesson.
 */
export const LESSON_MIN_OCCURRENCES = 1;

/** How many finished runs of the repository the signal reads. */
export const LESSONS_RUN_WINDOW = 50;

/** The name of the skill that carries the lessons into an attempt. */
export const LESSON_SKILL_NAME = 'aip-lessons';

export const LESSON_KINDS = ['delivery', 'outside_changes', 'denial', 'rejected'] as const;

export type LessonKind = (typeof LESSON_KINDS)[number];

/** What backs a lesson: how often out of how many attempts, on which tasks, and when last. */
export interface LessonEvidence {
  /** How many times the pattern occurred in the window. */
  occurrences: number;
  /** How many attempts of the specialist the window had: the denominator of `occurrences`. */
  attempts: number;
  tasks: number[];
  seenAt: number;
}

/** One objective lesson: a pattern of the outcomes of earlier runs with its evidence. */
export interface Lesson {
  id: string;
  kind: LessonKind;
  text: string;
  evidence: LessonEvidence;
  /** The larger, the more often and the less preventable the pattern: what survives the limit first. */
  priority: number;
}

/** The lessons of one specialist, as the attempt gets them. */
export interface LessonBlock {
  text: string;
  /** How many lessons fit the limit. */
  lessons: number;
  /** How many lessons did not fit the limit. */
  dropped: number;
}

/** The lessons of one specialist of a run, as `run_lessons` answers. */
export interface LessonSummarySpecialist {
  specialist: string;
  attempts: number;
  verdicts: SpecialistSignal['verdicts'];
  denials: number;
  outsideChanges: number;
  deliveryFailures: number;
  lessons: Lesson[];
  block: string;
  dropped: number;
}

/** The lessons of every specialist that ran in a run. */
export interface LessonSummary {
  runId: string;
  repository: string;
  specialists: LessonSummarySpecialist[];
}

export interface RenderedLessons {
  text: string;
  lessons: Lesson[];
  dropped: number;
}

export const LESSON_HEADER =
  '# Lessons from earlier runs\n\n' +
  `Observed outcomes of the last ${LESSONS_RUN_WINDOW} finished runs of this repository. Each lesson says how often it happened, on which tasks and when; check it against the current code before you rely on it.\n`;

const KIND_WEIGHT: Record<LessonKind, number> = {
  delivery: 4,
  outside_changes: 3,
  denial: 2,
  rejected: 1,
};

/** Turns the objective signal of a specialist into lessons, most severe first. */
export function lessonsFromSignal(signal: SpecialistSignal): Lesson[] {
  const attempts = signal.attempts;
  const lessons: Lesson[] = signal.deliveries.map((one) => deliveryLesson(one, attempts));
  if (signal.outside !== null) lessons.push(outsideLesson(signal.outside, attempts));
  lessons.push(...signal.denials.map((one) => denialLesson(one, attempts)));
  if (signal.rejected.count > 0) lessons.push(rejectedLesson(signal, attempts));
  return lessons.sort(compareLessons);
}

/** The lessons that fit the limit, whole; the rest is dropped by priority and counted. */
export function renderLessons(
  lessons: readonly Lesson[],
  limit: number = LESSON_BLOCK_LIMIT,
): RenderedLessons {
  const sorted = [...lessons].sort(compareLessons).slice(0, LESSON_COUNT_LIMIT);
  let dropped = lessons.length - sorted.length;
  const included: Lesson[] = [];
  let length = LESSON_HEADER.length;
  for (const lesson of sorted) {
    const line = `- ${lesson.text}`;
    if (length + line.length + 1 > limit) {
      dropped += 1;
      continue;
    }
    included.push(lesson);
    length += line.length + 1;
  }
  return {
    text:
      included.length === 0
        ? ''
        : `${LESSON_HEADER}\n${included.map((one) => `- ${one.text}`).join('\n')}`,
    lessons: included,
    dropped,
  };
}

function compareLessons(left: Lesson, right: Lesson): number {
  return right.priority - left.priority || left.id.localeCompare(right.id);
}

function deliveryLesson(signal: DeliverySignal, attempts: number): Lesson {
  const what =
    signal.state === 'apply_failed'
      ? 'Applying the result of the group failed'
      : 'Pushing the result of the group failed';
  const reason = signal.reasons[0] === undefined ? '' : ` Reason: ${clip(signal.reasons[0])}.`;
  const conflicts =
    signal.conflicts.length === 0
      ? ''
      : ` Conflicts: ${signal.conflicts.map(conflictText).join(', ')}.`;
  const advice =
    signal.state === 'apply_failed'
      ? conflicts === ''
        ? 'Before the group is reported done, check that its result applies to the base branch.'
        : 'Before the group is reported done, make sure its changes agree with the base branch.'
      : 'The push runs after the group is merged and does not depend on the attempt.';
  return {
    id: `delivery:${signal.state}`,
    kind: 'delivery',
    text: `${what} ${evidence(signal, attempts)}.${reason}${conflicts} ${advice}`,
    evidence: evidenceOf(signal, attempts),
    priority: signal.count * 10 + KIND_WEIGHT.delivery,
  };
}

function outsideLesson(signal: OutsideSignal, attempts: number): Lesson {
  const examples =
    signal.paths.length === 0
      ? ''
      : ` Examples: ${signal.paths.map((path) => clip(path, 120)).join(', ')}.`;
  return {
    id: 'outside_changes',
    kind: 'outside_changes',
    text: `Changes outside your worktree were detected ${evidence(signal, attempts)}.${examples} Every change outside the worktree is discarded.`,
    evidence: evidenceOf(signal, attempts),
    priority: signal.count * 10 + KIND_WEIGHT.outside_changes,
  };
}

function denialLesson(signal: DenialSignal, attempts: number): Lesson {
  const tool = clip(signal.tool, 80);
  const example =
    signal.commands[0] === undefined ? '' : ` Example: \`${clip(signal.commands[0], 80)}\`.`;
  return {
    id: `denial:${tool}`,
    kind: 'denial',
    text: `Tool calls of \`${tool}\` were denied ${evidence(signal, attempts)}.${example} Only the allowed tools and commands run.`,
    evidence: evidenceOf(signal, attempts),
    priority: signal.count * 10 + KIND_WEIGHT.denial,
  };
}

function rejectedLesson(signal: SpecialistSignal, attempts: number): Lesson {
  return {
    id: 'rejected',
    kind: 'rejected',
    text: `A reviewer rejected the result ${evidence(signal.rejected, attempts)}. Address the feedback of the previous review before you report done.`,
    evidence: evidenceOf(signal.rejected, attempts),
    priority: signal.rejected.count * 10 + KIND_WEIGHT.rejected,
  };
}

function evidenceOf(
  signal: { count: number; tasks: number[]; seenAt: number },
  attempts: number,
): LessonEvidence {
  return {
    occurrences: signal.count,
    attempts: Math.max(attempts, signal.count),
    tasks: [...signal.tasks],
    seenAt: signal.seenAt,
  };
}

function evidence(
  signal: { count: number; tasks: number[]; seenAt: number },
  attempts: number,
): string {
  return `${times(signal.count, attempts)} (${tasksText(signal.tasks)}; last seen ${date(signal.seenAt)})`;
}

/** `4 of 12 attempts` when the denominator is known, a bare count when the signal has none. */
function times(count: number, attempts: number): string {
  if (attempts < count || attempts <= 0) return count === 1 ? 'once' : `${count} times`;
  const window = attempts === 1 ? 'attempt' : 'attempts';
  return `${count} of ${attempts} ${window}`;
}

function tasksText(tasks: number[]): string {
  const shown = tasks.slice(0, 5).map((task) => `#${task}`);
  const rest = tasks.length - shown.length;
  const list = shown.length === 0 ? 'no tasks' : shown.join(', ');
  return rest > 0 ? `tasks ${list}, +${rest} more` : `tasks ${list}`;
}

function date(seenAt: number): string {
  return seenAt <= 0 ? 'unknown' : new Date(seenAt).toISOString().slice(0, 10);
}

/**
 * One line of lesson text from a value an agent or git wrote: no line breaks (a lesson is one
 * line), no backticks (they would close the code span around the value) and no flood of spaces.
 */
function clip(text: string, limit = 200): string {
  const flat = text.replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** A conflicting file with how often it conflicted when that is more than once. */
function conflictText(conflict: FileCount): string {
  const path = clip(conflict.path, 120);
  return conflict.count > 1 ? `${path} (${conflict.count})` : path;
}
