import { useTranslation } from 'react-i18next';

import type { RepositoryView } from '../../../shared/api/types.ts';

/** One line with the names of the projects whose queues have nothing to show; a name opens its block. */
export function EmptyQueues({
  projects,
  onOpen,
}: {
  projects: readonly Pick<RepositoryView, 'path' | 'label'>[];
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  if (projects.length === 0) return null;
  return (
    <p className="text-sm text-muted-foreground" data-empty-queues>
      {t('queue.all.empty')}{' '}
      {projects.map((entry, index) => (
        <span key={entry.path}>
          {index > 0 ? ', ' : null}
          <button
            type="button"
            className="underline"
            aria-label={t('queue.all.showEmpty', { project: entry.label })}
            onClick={() => onOpen(entry.path)}
          >
            {entry.label}
          </button>
        </span>
      ))}
    </p>
  );
}
