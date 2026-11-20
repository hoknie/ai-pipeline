import type { Readable } from '../../../../feature/access/services/index.ts';
import type { IpcContext } from '../types.ts';

/** The projects the actor reads: the lists of the answers keep only these. */
export const readableOf = (context: IpcContext): Readable =>
  context.services.access.readableRepositories(context.actor);

/** The items of a list that belong to a readable project; the list as it is when all are readable. */
export function visible<T>(
  context: IpcContext,
  items: readonly T[],
  projectOf: (item: T) => string | null,
): T[] {
  const readable = readableOf(context);
  if (readable.all) return [...items];
  return items.filter((item) => {
    const project = projectOf(item);
    return project !== null && readable.has(project);
  });
}
