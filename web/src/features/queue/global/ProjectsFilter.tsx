import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { GlobalQueueView, RepositoryView } from '../../../shared/api/types.ts';
import { FilterField } from '../../../shared/ui/forms/filters/FilterField.tsx';

/** Which projects the global queue takes tasks of; changed only while the queue is stopped. */
export function ProjectsFilter({
  api,
  queue,
  projects,
  onError,
}: {
  api: Api;
  queue: GlobalQueueView;
  projects: readonly RepositoryView[];
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string[] | null>(null);
  const selected = pending ?? queue.filter.projects;
  const change = async (values: string[]) => {
    setPending(values);
    try {
      await api.queueSettings({ filter: { projects: values } });
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending(null);
    }
  };
  return (
    <section
      aria-label={t('queue.global.projects')}
      className="flex flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('queue.global.projects')}</h3>
      <p className="text-sm text-muted-foreground">{t('queue.global.projectsHelp')}</p>
      <FilterField
        label={t('queue.global.projects')}
        options={projects.map((entry) => ({ value: entry.path, label: entry.label }))}
        selected={selected}
        onChange={(values) => void change(values)}
        clearLabel={t('queue.filter.clear')}
        disabled={queue.status === 'running' || pending !== null}
      />
      {queue.status === 'running' ? (
        <p className="text-sm text-muted-foreground">{t('queue.filter.locked')}</p>
      ) : null}
    </section>
  );
}
