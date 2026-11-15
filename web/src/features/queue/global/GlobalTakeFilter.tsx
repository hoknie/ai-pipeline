import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  GlobalQueueView,
  PipelinesView,
  QueueView,
  RepositoryView,
} from '../../../shared/api/types.ts';
import { FilterField, type FilterOption } from '../../../shared/ui/forms/filters/FilterField.tsx';
import { FilterBlock } from '../filter/FilterBlock.tsx';

type Lists = { pipelines: string[]; projects: string[] };

/** The pipelines of all projects without repeats by id: the first name wins. */
function pipelineOptions(
  byPath: ReadonlyMap<string, PipelinesView>,
  shown: string[],
  unknown: string,
): FilterOption[] {
  const known = new Map<string, string>();
  for (const view of byPath.values())
    for (const item of view.pipelines) if (!known.has(item.id)) known.set(item.id, item.name);
  return [
    ...[...known].map(([value, label]) => ({ value, label })),
    ...shown
      .filter((id) => !known.has(id))
      .map((value) => ({ value, label: `${value} (${unknown})` })),
  ];
}

/** The take filter of the global queue: pipelines of all projects and the projects themselves. */
export function GlobalTakeFilter({
  api,
  queue,
  projects,
  pipelines,
  onQueue,
  onError,
}: {
  api: Api;
  queue: GlobalQueueView;
  /** The enabled projects of the registry. */
  projects: readonly RepositoryView[];
  pipelines: ReadonlyMap<string, PipelinesView>;
  /** Takes the answer of the daemon: in the global mode the global queue. */
  onQueue: (queue: QueueView | GlobalQueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Partial<Lists> | null>(null);
  const shown: Lists = {
    pipelines: pending?.pipelines ?? queue.filter.pipelines,
    projects: pending?.projects ?? queue.filter.projects,
  };
  const change = async (patch: Partial<Lists>) => {
    setPending(patch);
    try {
      onQueue(await api.queueSettings({ filter: patch }));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending(null);
    }
  };
  const running = queue.status === 'running';
  const locked = running || pending !== null;
  return (
    <FilterBlock
      count={shown.pipelines.length + shown.projects.length}
      running={running}
      locked={locked}
      onReset={() => void change({ pipelines: [], projects: [] })}
    >
      <FilterField
        label={t('queue.filter.pipelines')}
        options={pipelineOptions(pipelines, shown.pipelines, t('queue.filter.unknown'))}
        selected={shown.pipelines}
        onChange={(values) => void change({ pipelines: values })}
        clearLabel={t('queue.filter.clear')}
        disabled={locked}
      />
      <FilterField
        label={t('queue.global.projects')}
        options={projects.map((entry) => ({ value: entry.path, label: entry.label }))}
        selected={shown.projects}
        onChange={(values) => void change({ projects: values })}
        clearLabel={t('queue.filter.clear')}
        disabled={locked}
      />
    </FilterBlock>
  );
}
