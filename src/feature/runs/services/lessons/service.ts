import type { LessonStorage, LessonsRepository } from '../../repositories/index.ts';
import {
  LESSONS_RUN_WINDOW,
  allGroups,
  collectSignal,
  fitLessonFile,
  lessonsFromSignal,
  renderLessons,
  selectLessons,
  type ArchivedLesson,
  type Lesson,
  type LessonBlock,
  type LessonFile,
  type LessonSummary,
  type LessonSummarySpecialist,
  type RunState,
  type SelectedLessons,
  type SpecialistSignal,
  type SuppressedLesson,
} from '../../types/index.ts';

export interface LessonsDependencies {
  runs: LessonsRepository;
  storage: LessonStorage;
  now: () => number;
}

/**
 * Lessons from the finished runs of a repository: the signal is the objective outcome of earlier
 * attempts, the lessons are written beside the state directory and handed to an attempt as a skill.
 */
export class RunLessons {
  private readonly dependencies: LessonsDependencies;
  /** The finished runs of a repository, reloaded only when the history or a delivery changed. */
  private readonly cache = new Map<string, { key: string; runs: RunState[] }>();

  constructor(dependencies: LessonsDependencies) {
    this.dependencies = dependencies;
  }

  /** The lessons of every specialist that ran in the run, without writing anything. */
  summary(state: RunState): LessonSummary {
    return {
      runId: state.run.id,
      repository: state.run.repository,
      specialists: specialistsOf(state).map((specialist) =>
        this.summaryOf(state.run.repository, specialist),
      ),
    };
  }

  /** The block an attempt of the specialist gets; null when there is nothing to teach it. */
  block(repository: string, specialist: string): LessonBlock | null {
    try {
      const now = this.dependencies.now();
      const previous = this.dependencies.storage.read(repository, specialist, now);
      const selection = selectLessons(
        lessonsFromSignal(this.signalOf(repository, specialist)),
        previous,
        now,
      );
      if (
        selection.lessons.length === 0 &&
        selection.archived.length === 0 &&
        selection.suppressed.length === 0
      ) {
        this.dependencies.storage.remove(repository, specialist);
        return null;
      }
      const file = this.keep(repository, specialist, previous, selection, now);
      if (file.lessons.length === 0) return null;
      const rendered = renderLessons(file.lessons);
      return {
        text: rendered.text,
        lessons: file.lessons.length,
        dropped: selection.dropped + (selection.lessons.length - file.lessons.length),
      };
    } catch {
      // Lessons are an improvement to an attempt, never a reason for it not to start.
      return null;
    }
  }

  /**
   * Writes the file when the lessons or the archive changed, keeping the version and the date of
   * the last change: the file is the artifact a person reads, not a log of every attempt. The file
   * is fitted to its character limit first, so the block and the file always agree.
   */
  private keep(
    repository: string,
    specialist: string,
    previous: LessonFile | null,
    selection: SelectedLessons,
    now: number,
  ): LessonFile {
    const draft: LessonFile = {
      repository,
      specialist,
      version: previous?.version ?? 1,
      generatedAt: previous?.generatedAt ?? now,
      window: LESSONS_RUN_WINDOW,
      lessons: selection.lessons,
      archived: selection.archived,
      suppressed: selection.suppressed,
    };
    const fitted = fitLessonFile(draft);
    if (previous !== null && sameContent(previous, fitted)) return previous;
    const next = fitLessonFile({
      ...fitted,
      version: (previous?.version ?? 0) + 1,
      generatedAt: now,
    });
    this.dependencies.storage.write(next);
    return next;
  }

  /**
   * The typed signal of one specialist of a repository: the objective outcome of its earlier
   * finished attempts. The lessons and the block an attempt gets are built from it.
   */
  signalOf(repository: string, specialist: string): SpecialistSignal {
    return collectSignal(this.finishedRuns(repository), specialist);
  }

  private summaryOf(repository: string, specialist: string): LessonSummarySpecialist {
    try {
      const signal = this.signalOf(repository, specialist);
      const lessons = lessonsFromSignal(signal);
      const rendered = renderLessons(lessons);
      return {
        specialist,
        attempts: signal.attempts,
        verdicts: { ...signal.verdicts },
        denials: signal.denials.reduce((total, one) => total + one.count, 0),
        outsideChanges: signal.outside?.count ?? 0,
        deliveryFailures: signal.deliveries.reduce((total, one) => total + one.count, 0),
        lessons,
        block: rendered.text,
        dropped: rendered.dropped,
      };
    } catch {
      return emptySummary(specialist);
    }
  }

  /**
   * The finished runs of a repository, hydrated once and kept until the history or a delivery of
   * the window changes: every attempt start and every specialist of a summary would otherwise
   * parse the same history again.
   */
  private finishedRuns(repository: string): RunState[] {
    const version = this.dependencies.runs.version(repository, LESSONS_RUN_WINDOW);
    const key = `${version.count}:${version.lastFinishedAt}:${version.deliveries}`;
    const cached = this.cache.get(repository);
    if (cached !== undefined && cached.key === key) return cached.runs;
    const runs = this.dependencies.runs.finishedRuns(repository, LESSONS_RUN_WINDOW);
    this.cache.set(repository, { key, runs });
    return runs;
  }
}

function emptySummary(specialist: string): LessonSummarySpecialist {
  return {
    specialist,
    attempts: 0,
    verdicts: { done: 0, rejected: 0, needs_human: 0, failed: 0 },
    denials: 0,
    outsideChanges: 0,
    deliveryFailures: 0,
    lessons: [],
    block: '',
    dropped: 0,
  };
}

/** The specialists that ran attempts of their own in the run, in the order they took part. */
function specialistsOf(state: RunState): string[] {
  const found: string[] = [];
  for (const group of allGroups(state)) {
    for (const attempt of group.attempts) {
      if (attempt.runtime === 'command') continue;
      if (!found.includes(attempt.specialist)) found.push(attempt.specialist);
    }
  }
  return found;
}

/** Whether a fresh read of the signal leaves the file exactly as it was. */
function sameContent(previous: LessonFile, selection: LessonFile): boolean {
  return (
    previous.window === LESSONS_RUN_WINDOW &&
    signature(previous.lessons, previous.archived, previous.suppressed) ===
      signature(selection.lessons, selection.archived, selection.suppressed)
  );
}

/** What the version and the date of a file stand for: the lessons and the archive, not the counts behind them. */
function signature(
  lessons: readonly Lesson[],
  archived: readonly ArchivedLesson[],
  suppressed: readonly SuppressedLesson[],
): string {
  return JSON.stringify([
    lessons.map((lesson) => [lesson.id, lesson.text]),
    archived.map((lesson) => [lesson.id, lesson.text, lesson.archivedAt]),
    suppressed.map((lesson) => [lesson.id, lesson.text, lesson.suppressedAt]),
  ]);
}
