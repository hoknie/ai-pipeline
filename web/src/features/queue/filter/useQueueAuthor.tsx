import type { ReactNode } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { QueueItemView, QueueRunView, RunView } from '../../../shared/api/types.ts';
import { authorIdOf, useAuthorChoices } from '../../../shared/lib/catalog/authors.ts';
import { AuthorFilter } from '../../../shared/ui/forms/filters/AuthorFilter.tsx';

/**
 * The author filter of the queue page: the bar with «Mine» and the list of users (server mode
 * only), and what hides the tasks and the runs of the others; undefined while nobody is chosen.
 */
export function useQueueAuthor(
  api: Api,
  runs: RunView[],
  author: string | null,
  onAuthor: ((author: string | null) => void) | undefined,
): {
  bar: ReactNode;
  itemVisible: ((item: QueueItemView) => boolean) | undefined;
  runVisible: ((run: QueueRunView) => boolean) | undefined;
} {
  const choices = useAuthorChoices(api);
  const authorId = choices.enabled ? authorIdOf(author, choices.meId) : null;
  const bar =
    choices.enabled && onAuthor ? (
      <AuthorFilter toggle value={author} users={choices.users} onChange={onAuthor} />
    ) : null;
  if (authorId === null) return { bar, itemVisible: undefined, runVisible: undefined };
  return {
    bar,
    itemVisible: (item) => item.author?.id === authorId,
    // a run of the queue carries no author: the runs of the panel tell whose it is
    runVisible: (run) => runs.find((one) => one.id === run.id)?.author?.id === authorId,
  };
}
