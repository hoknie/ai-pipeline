import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RunView } from '../../../shared/api/types.ts';
import { authorIdOf, useAuthorChoices } from '../../../shared/lib/catalog/authors.ts';
import type { RunsPageProps } from './types.ts';
import { AuthorFilter } from '../../../shared/ui/forms/filters/AuthorFilter.tsx';

/**
 * The author filter of the list of runs: the runs of the chosen author, and the bar with «Mine»
 * and the list of users (server mode only). Older runs of the author come by pages while none is
 * in the list.
 */
export function useAuthorBar(page: RunsPageProps): { authored: RunView[]; bar: ReactNode } {
  const { api, runs, route, onRoute, history } = page;
  const { t } = useTranslation();
  const choices = useAuthorChoices(api);
  const authorId = choices.enabled ? authorIdOf(route.author, choices.meId) : null;
  const authored = authorId === null ? runs : runs.filter((item) => item.author?.id === authorId);
  useEffect(() => {
    if (authorId === null || authored.length > 0 || !history) return;
    if (!history.done && !history.loading && history.error === null) history.loadMore();
  }, [authorId, authored.length, history]);
  const bar = choices.enabled ? (
    <>
      <AuthorFilter
        toggle
        value={route.author ?? null}
        users={choices.users}
        onChange={(author) => onRoute({ ...route, author })}
      />
      {authorId !== null && authored.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('author.filter.empty')}</p>
      ) : null}
    </>
  ) : null;
  return { authored, bar };
}
