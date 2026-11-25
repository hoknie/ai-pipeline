import {
  LESSON_BLOCK_LIMIT,
  LESSON_FILE_LIMIT,
  LESSON_HEADER,
  LESSON_MIN_OCCURRENCES,
  renderLessons,
  type Lesson,
} from './lessons.ts';

/** A lesson whose pattern disappeared from the window: kept in the file, never given to an attempt. */
export interface ArchivedLesson extends Lesson {
  /** When the pattern disappeared and the lesson moved to the archive (ms). */
  archivedAt: number;
}

/** A lesson a person removed from the file: kept out of the active list until they undo it. */
export interface SuppressedLesson extends Lesson {
  /** When the lesson was removed from the active list by hand (ms). */
  suppressedAt: number;
}

/**
 * The lessons of one (repository, specialist) pair, as the file keeps them: the active lessons a
 * prompt gets, the archive of the rules the last window no longer sees, and the rules a person
 * removed by hand.
 */
export interface LessonFile {
  repository: string;
  specialist: string;
  /** Grows by one whenever the lessons or the archive change; the first file is version 1. */
  version: number;
  /** When the lessons or the archive last changed (ms). */
  generatedAt: number;
  /** How many finished runs of the repository the lessons were built from. */
  window: number;
  /** The active lessons, the most important first. */
  lessons: Lesson[];
  /** The lessons whose pattern is gone, the most recently archived first. */
  archived: ArchivedLesson[];
  /** The lessons removed by hand, the most recently removed first. */
  suppressed: SuppressedLesson[];
}

/** The part of an earlier file a fresh read of the signal starts from. */
export interface LessonSource {
  lessons: readonly Lesson[];
  archived: readonly ArchivedLesson[];
  suppressed?: readonly SuppressedLesson[];
}

/** What a fresh read of the signal makes of a lessons file. */
export interface SelectedLessons {
  /** The active lessons that fit the prompt limit, the most important first. */
  lessons: Lesson[];
  /** The lessons whose pattern disappeared from the window. */
  archived: ArchivedLesson[];
  /** The lessons a person removed by hand; they never become active again. */
  suppressed: SuppressedLesson[];
  /** How many candidates did not fit the prompt limit. */
  dropped: number;
  /** The block an attempt gets, built from the active lessons. */
  text: string;
}

/**
 * Rebuilds a lessons file from the signal of the repository. Deterministic: the same candidates
 * and the same previous file always give the same result. A lesson whose pattern is gone from the
 * window moves to the archive instead of disappearing; an archived lesson whose pattern is back
 * becomes active again when it fits the limit and otherwise stays archived. A lesson a person
 * removed by hand never becomes active again.
 */
export function selectLessons(
  candidates: readonly Lesson[],
  previous: LessonSource | null,
  archivedAt: number,
  limit: number = LESSON_BLOCK_LIMIT,
): SelectedLessons {
  const suppressed = [...(previous?.suppressed ?? [])];
  const removed = new Set(suppressed.map((lesson) => lesson.id));
  const observed = candidates.filter(
    (lesson) => lesson.evidence.occurrences >= LESSON_MIN_OCCURRENCES && !removed.has(lesson.id),
  );
  const rendered = renderLessons(observed, limit);
  const active = new Set(rendered.lessons.map((lesson) => lesson.id));
  const archived: ArchivedLesson[] = [];
  const kept = new Set<string>();
  for (const lesson of previous?.archived ?? []) {
    if (removed.has(lesson.id) || active.has(lesson.id) || kept.has(lesson.id)) continue;
    // The pattern is back but did not fit the prompt limit: it waits in the archive, not in limbo.
    kept.add(lesson.id);
    archived.push(lesson);
  }
  for (const lesson of previous?.lessons ?? []) {
    if (
      removed.has(lesson.id) ||
      active.has(lesson.id) ||
      observed.some((one) => one.id === lesson.id) ||
      kept.has(lesson.id)
    ) {
      continue;
    }
    kept.add(lesson.id);
    archived.push({ ...lesson, archivedAt });
  }
  archived.sort(compareArchived);
  return {
    lessons: rendered.lessons,
    archived,
    suppressed,
    dropped: rendered.dropped,
    text: rendered.text,
  };
}

/** The most recently archived first, then the most important: a stable order between runs. */
function compareArchived(left: ArchivedLesson, right: ArchivedLesson): number {
  return (
    right.archivedAt - left.archivedAt ||
    right.priority - left.priority ||
    left.id.localeCompare(right.id)
  );
}

/**
 * The file as a person reads it: the front matter carries the structured records (one JSON value
 * per line, which is also valid YAML), the body the same lessons as markdown. The id in brackets
 * is how a removed line is recognised on the next read.
 */
export function formatLessonFile(file: LessonFile): string {
  return [
    '---',
    `specialist: ${file.specialist}`,
    `repository: ${file.repository}`,
    `version: ${file.version}`,
    `generatedAt: ${file.generatedAt}`,
    `window: ${file.window}`,
    `lessons: ${JSON.stringify(file.lessons)}`,
    `archived: ${JSON.stringify(file.archived)}`,
    `suppressed: ${JSON.stringify(file.suppressed)}`,
    '---',
    '',
    activeSection(file),
    archiveSection(file),
    suppressedSection(file),
    '',
  ].join('\n');
}

/**
 * Drops the least important records until the file fits its character limit: the oldest archived
 * lessons first, then the least important active ones. The dropping is deterministic, so the same
 * file always ends the same way.
 */
export function fitLessonFile(file: LessonFile): LessonFile {
  let archived = [...file.archived];
  while (
    archived.length > 0 &&
    formatLessonFile({ ...file, archived }).length > LESSON_FILE_LIMIT
  ) {
    archived = archived.slice(0, -1);
  }
  let lessons = [...file.lessons];
  while (
    lessons.length > 0 &&
    formatLessonFile({ ...file, archived, lessons }).length > LESSON_FILE_LIMIT
  ) {
    lessons = lessons.slice(0, -1);
  }
  let suppressed = [...file.suppressed];
  while (
    suppressed.length > 0 &&
    formatLessonFile({ ...file, archived, lessons, suppressed }).length > LESSON_FILE_LIMIT
  ) {
    suppressed = suppressed.slice(0, -1);
  }
  return { ...file, archived, lessons, suppressed };
}

function activeSection(file: LessonFile): string {
  if (file.lessons.length === 0) return '';
  const lines = file.lessons.map((lesson) => `- [${lesson.id}] ${lesson.text}`);
  return `${LESSON_HEADER.trimEnd()}\n\n${lines.join('\n')}`;
}

/** The archived lessons as markdown: visible to a person, never part of the block a prompt gets. */
function archiveSection(file: LessonFile): string {
  if (file.archived.length === 0) return '';
  const lines = file.archived.map(
    (lesson) => `- (archived ${day(lesson.archivedAt)}) [${lesson.id}] ${lesson.text}`,
  );
  return [
    '',
    '## Archived lessons',
    '',
    `Rules whose pattern was not seen in the last ${file.window} finished runs. They stay here for review and are not given to attempts.`,
    '',
    ...lines,
  ].join('\n');
}

/** The rules a person removed: out of attempts, but still visible and easy to restore. */
function suppressedSection(file: LessonFile): string {
  if (file.suppressed.length === 0) return '';
  const lines = file.suppressed.map(
    (lesson) => `- (removed ${day(lesson.suppressedAt)}) [${lesson.id}] ${lesson.text}`,
  );
  return [
    '',
    '## Removed lessons',
    '',
    'Rules removed from this file by hand. They are not given to attempts while this section names them; delete the section or a line to let a rule come back.',
    '',
    ...lines,
  ].join('\n');
}

function day(at: number): string {
  return at <= 0 ? 'unknown' : new Date(at).toISOString().slice(0, 10);
}
