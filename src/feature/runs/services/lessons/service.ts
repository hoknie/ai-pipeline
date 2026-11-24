import type { LessonStorage, LessonsRepository } from '../../repositories/index.ts';
import {
  LESSONS_RUN_WINDOW,
  allGroups,
  collectSignal,
  lessonsFromSignal,
  renderLessons,
  type LessonBlock,
  type LessonSummary,
  type LessonSummarySpecialist,
  type RenderedLessons,
  type RunState,
  type SpecialistSignal,
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
      const { rendered } = this.computed(repository, specialist);
      if (rendered.lessons.length === 0) {
        this.dependencies.storage.remove(repository, specialist);
        return null;
      }
      this.keep(repository, specialist, rendered.text);
      return {
        text: rendered.text,
        lessons: rendered.lessons.length,
        dropped: rendered.dropped,
      };
    } catch {
      // Lessons are an improvement to an attempt, never a reason for it not to start.
      return null;
    }
  }

  /** Writes the file when the text changed, keeping the version and the date of the last change. */
  private keep(repository: string, specialist: string, text: string): void {
    const previous = this.dependencies.storage.read(repository, specialist);
    if (previous?.text === text) return;
    this.dependencies.storage.write({
      repository,
      specialist,
      version: (previous?.version ?? 0) + 1,
      generatedAt: this.dependencies.now(),
      text,
    });
  }

  private summaryOf(repository: string, specialist: string): LessonSummarySpecialist {
    try {
      const signal = this.signal(repository, specialist);
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

  private computed(
    repository: string,
    specialist: string,
  ): { signal: SpecialistSignal; rendered: RenderedLessons } {
    const signal = this.signal(repository, specialist);
    return { signal, rendered: renderLessons(lessonsFromSignal(signal)) };
  }

  private signal(repository: string, specialist: string): SpecialistSignal {
    return collectSignal(this.finishedRuns(repository), specialist);
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
