import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import type { QueueItemView, QueueView, RunView, TaskLinkView } from '../../../shared/api/types.ts';
import type { LinkKind } from './linkKinds.ts';

export interface ParentChoice {
  id: string;
  number: number;
  title: string;
  /** In progress, planned (not started or put back in the queue) or finished. */
  section: 'active' | 'planned' | 'finished';
}

const SECTION_ORDER: Record<ParentChoice['section'], number> = {
  active: 0,
  planned: 1,
  finished: 2,
};

/**
 * The runs of `repository` a task can be a child of, finished ones included: in progress first
 * (newest start first), then planned (newest created first), then finished (latest finish first).
 */
export function parentChoices(runs: readonly RunView[], repository: string): ParentChoice[] {
  const keyed = runs
    .filter((run) => run.repository === repository)
    .map((run) => {
      const section: ParentChoice['section'] =
        (run.state === 'queued' && run.queueItem !== null) ||
        (!run.finished && run.startedAt === null)
          ? 'planned'
          : run.finished
            ? 'finished'
            : 'active';
      const key =
        section === 'finished'
          ? (run.finishedAt ?? run.createdAt)
          : section === 'active'
            ? (run.startedAt ?? run.createdAt)
            : run.createdAt;
      return { run, section, key };
    });
  keyed.sort(
    (a, b) =>
      SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
      b.key - a.key ||
      b.run.createdAt - a.run.createdAt ||
      a.run.id.localeCompare(b.run.id, 'en'),
  );
  return keyed.map(({ run, section }) => ({
    id: run.id,
    number: run.number,
    title: run.title,
    section,
  }));
}

export type LinkTargetSection =
  'items' | 'queueRuns' | 'active' | 'planned' | 'finished' | 'other' | 'current';
export interface LinkTarget {
  id: string;
  number: number | null;
  title: string;
  project?: string;
}
export interface LinkTargetGroup {
  section: LinkTargetSection;
  options: LinkTarget[];
}

function currentTarget(ref: TaskLinkView, repository: string): LinkTarget {
  return {
    id: ref.id,
    number: ref.title ? ref.number : null,
    title: ref.title || ref.id,
    ...(ref.repository && ref.repository !== repository
      ? { project: repositoryLabel(ref.repository) }
      : {}),
  };
}

/** Ordered, deduplicated choices for a link; queues must contain enabled projects only. */
export function linkTargets(
  kind: LinkKind,
  queue: QueueView,
  runs: readonly RunView[],
  label: (item: QueueItemView) => string,
  editing?: Pick<QueueItemView, 'id' | 'links'>,
  others: readonly QueueView[] = [],
): LinkTargetGroup[] {
  const seen = new Set<string>(editing ? [editing.id] : []);
  const groups: LinkTargetGroup[] = [];
  const add = (section: LinkTargetSection, choices: LinkTarget[]) => {
    const options = choices.filter((choice) => {
      if (seen.has(choice.id)) return false;
      seen.add(choice.id);
      return true;
    });
    if (options.length) groups.push({ section, options });
  };
  const forQueue = (source: QueueView, foreign: boolean) => {
    const project = foreign ? repositoryLabel(source.repository) : undefined;
    const decorate = (choice: LinkTarget): LinkTarget =>
      project ? { ...choice, project } : choice;
    const sections: { section: LinkTargetSection; options: LinkTarget[] }[] = [
      {
        section: 'items',
        options: source.items.map((item) =>
          decorate({ id: item.id, number: item.number, title: label(item) }),
        ),
      },
    ];
    if (kind === 'blocked_by') {
      const byId = new Map(runs.map((run) => [run.id, run]));
      const sorted = [...source.runs].sort(
        (a, b) =>
          (byId.get(b.id)?.startedAt ?? b.createdAt) - (byId.get(a.id)?.startedAt ?? a.createdAt) ||
          b.createdAt - a.createdAt ||
          a.id.localeCompare(b.id, 'en'),
      );
      sections.push({
        section: 'queueRuns',
        options: sorted.map((run) =>
          decorate({ id: run.id, number: run.number, title: run.title }),
        ),
      });
    } else {
      const choices = parentChoices(runs, source.repository);
      for (const section of ['active', 'planned', 'finished'] as const)
        sections.push({
          section,
          options: choices
            .filter((choice) => choice.section === section)
            .map((choice) =>
              decorate({ id: choice.id, number: choice.number, title: choice.title }),
            ),
        });
    }
    return sections;
  };
  for (const section of forQueue(queue, false)) add(section.section, section.options);
  const foreign = [...others]
    .filter((other) => other.repository !== queue.repository)
    .sort(
      (a, b) =>
        repositoryLabel(a.repository).localeCompare(repositoryLabel(b.repository), 'en') ||
        a.repository.localeCompare(b.repository, 'en'),
    );
  add(
    'other',
    foreign.flatMap((other) => forQueue(other, true).flatMap((section) => section.options)),
  );
  add(
    'current',
    (editing?.links ?? [])
      .filter((ref) => ref.kind === kind)
      .map((ref) => currentTarget(ref, queue.repository)),
  );
  return groups;
}
