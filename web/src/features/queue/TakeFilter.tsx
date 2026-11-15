import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { TFunction } from 'i18next';
import type { PipelinesView, QueueView, TagView } from '../../shared/api/types.ts';
import { useTags } from '../../shared/lib/catalog/tags.tsx';
import { FilterField, type FilterOption } from '../../shared/ui/forms/filters/FilterField.tsx';
import { FilterBlock } from './filter/FilterBlock.tsx';
import { useTakeFilter } from './filter/useTakeFilter.ts';

function filterOptions(
  pipelines: PipelinesView | null,
  shown: { pipelines: string[] },
  tags: TagView[],
  t: TFunction,
) {
  const known = new Map((pipelines?.pipelines ?? []).map((item) => [item.id, item.name]));
  const pipelineOptions: FilterOption[] = [
    ...[...known].map(([value, label]) => ({ value, label })),
    ...shown.pipelines
      .filter((id) => !known.has(id))
      .map((value) => ({ value, label: `${value} (${t('queue.filter.unknown')})` })),
  ];
  const tagOptions: FilterOption[] = tags.map((tag) => ({ value: tag.id, label: tag.name }));
  return { pipelineOptions, tagOptions };
}

/** A collapsible block above the controls: which new tasks a running queue takes. */
export function TakeFilter({
  api,
  queue,
  pipelines,
  onQueue,
  onError,
}: {
  api: Api;
  queue: QueueView;
  pipelines: PipelinesView | null;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const catalog = useTags();
  const { shown, change, saving } = useTakeFilter(api, queue, onQueue, onError);
  const count = shown.pipelines.length + shown.tags.length;
  const locked = queue.status === 'running' || saving;

  const repoTags = catalog.of(queue.repository);
  const { pipelineOptions, tagOptions } = filterOptions(pipelines, shown, repoTags, t);
  const toNames = (ids: string[]) =>
    ids.flatMap((id) => repoTags.find((tag) => tag.id === id)?.name ?? []);

  return (
    <FilterBlock
      count={count}
      running={queue.status === 'running'}
      locked={locked}
      onReset={() => void change({ pipelines: [], tags: [] })}
    >
      <FilterField
        label={t('queue.filter.pipelines')}
        options={pipelineOptions}
        selected={shown.pipelines}
        onChange={(values) => void change({ pipelines: values })}
        clearLabel={t('queue.filter.clear')}
        disabled={locked}
      />
      <FilterField
        label={t('queue.filter.tags')}
        options={tagOptions}
        selected={shown.tags}
        onChange={(values) => void change({ tags: values }, toNames)}
        clearLabel={t('queue.filter.clear')}
        disabled={locked}
      />
    </FilterBlock>
  );
}
