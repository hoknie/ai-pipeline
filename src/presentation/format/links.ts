import type { TaskLinkView } from '../../feature/queue/types/index.ts';
import { taskNumber } from './table.ts';

/**
 * `links: parent #3 · children #8, #9 · blocks #10`: the kinds that mean something beyond the
 * `after` dependencies. A task of another project carries the slug of its project (`lib:#4`);
 * a task without a number shows its id. '' when there is nothing of the kind: the dependencies
 * have their own `after` part.
 */
export function formatLinks(
  links: readonly TaskLinkView[],
  linkedBy: readonly TaskLinkView[],
  slugOf: (repository: string | null) => string | undefined,
): string {
  const label = (view: TaskLinkView): string => {
    const name = view.number === null ? view.id : taskNumber(view.number);
    const slug = slugOf(view.repository);
    return slug === undefined ? name : `${slug}:${name}`;
  };
  const group = (title: string, views: readonly TaskLinkView[]): string =>
    views.length === 0 ? '' : `${title} ${views.map(label).join(', ')}`;
  const part = (title: string, kind: TaskLinkView['kind'], where: readonly TaskLinkView[]) =>
    group(
      title,
      where.filter((view) => view.kind === kind),
    );
  const parts = [
    part('parent', 'parent', links),
    part('children', 'parent', linkedBy),
    part('blocks', 'blocked_by', linkedBy),
    part('related', 'related', links),
    part('duplicates', 'duplicates', links),
    part('duplicated by', 'duplicates', linkedBy),
  ].filter((entry) => entry !== '');
  return parts.length === 0 ? '' : `links: ${parts.join(' · ')}`;
}
