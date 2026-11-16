import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  GlobalQueueView,
  PipelinesView,
  QueueView,
  RepositoryView,
  TagView,
} from '../../../shared/api/types.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import { ProjectDot, PROJECT_DOT_CLASSES } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { FilterField, type FilterOption } from '../../../shared/ui/forms/filters/FilterField.tsx';
import { FilterBlock } from '../filter/FilterBlock.tsx';

type Lists = { pipelines: string[]; projects: string[]; tags: string[] };

/** The pipelines of all projects without repeats by id: the first name wins. */
function pipelineOptions(
  byPath: ReadonlyMap<string, PipelinesView>,
  projects: readonly RepositoryView[],
  shown: string[],
  unknown: string,
): FilterOption[] {
  const known = new Map<string, string>();
  for (const project of projects)
    for (const item of byPath.get(project.path)?.pipelines ?? [])
      if (!known.has(item.id)) known.set(item.id, item.name);
  return [
    ...[...known].map(([value, label]) => ({ value, label })),
    ...shown
      .filter((id) => !known.has(id))
      .map((value) => ({ value, label: `${value} (${unknown})` })),
  ];
}

type TagEntry = { project: string; color: string | null; tag: TagView };
const tagKey = (name: string) => name.toLocaleLowerCase('und');

function groupedTags(projects: readonly RepositoryView[], tags: TagView[]) {
  const groups = new Map<string, TagEntry[]>();
  for (const project of projects) {
    for (const tag of tags.filter((item) => item.repository === project.path)) {
      const key = tagKey(tag.name);
      groups.set(key, [
        ...(groups.get(key) ?? []),
        { project: project.label, color: project.color ?? null, tag },
      ]);
    }
  }
  return groups;
}

function markers(entries: TagEntry[]) {
  return entries.map(({ project, color }, index) => (
    <span
      key={`${project}:${index}`}
      title={project}
      aria-label={project}
      data-project-color={color ?? 'gray'}
      className={`inline-block size-3 rounded-full ${PROJECT_DOT_CLASSES[color ?? 'gray'] ?? PROJECT_DOT_CLASSES.gray}`}
    />
  ));
}

function labeledMarkers(entries: TagEntry[]) {
  return entries.map(({ project, color }, index) => (
    <span
      key={`${project}:${index}`}
      title={project}
      className="inline-flex items-center gap-1 rounded border px-1 text-xs"
    >
      <ProjectDot color={color ?? 'gray'} />
      {project}
    </span>
  ));
}

function optionsForTags(grouped: Map<string, TagEntry[]>, selected: string[], unknown: string) {
  const options: FilterOption[] = [...grouped].map(([key, entries]) => {
    const value = selected.find((name) => tagKey(name) === key) ?? entries[0]!.tag.name;
    const names = [...new Set(entries.map((entry) => entry.project))].join(' · ');
    return {
      value,
      label: value,
      keywords: names,
      render: (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{value}</span>
          <span className="flex flex-wrap gap-1">{labeledMarkers(entries)}</span>
        </span>
      ),
    };
  });
  for (const value of selected) {
    if (!grouped.has(tagKey(value))) options.push({ value, label: `${value} (${unknown})` });
  }
  return options;
}

function tagLook(grouped: Map<string, TagEntry[]>, unknown: string) {
  return {
    icon: (value: string) => markers(grouped.get(tagKey(value)) ?? []),
    hint: (value: string) =>
      grouped
        .get(tagKey(value))
        ?.map(({ project }) => project)
        .join(' · ') ?? unknown,
  };
}

/** The take filter of the global queue: pipelines and tags of all projects, and the projects themselves. */
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
  const { tags } = useTags();
  const [pending, setPending] = useState<Partial<Lists> | null>(null);
  const shown: Lists = {
    pipelines: pending?.pipelines ?? queue.filter.pipelines,
    projects: pending?.projects ?? queue.filter.projects,
    tags: pending?.tags ?? queue.filter.tags,
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
  const scoped = projects.filter(
    (project) => !shown.projects.length || shown.projects.includes(project.path),
  );
  const grouped = groupedTags(scoped, tags);
  const unknown = t('queue.filter.unknown');
  const tagOptions = optionsForTags(grouped, shown.tags, unknown);
  return (
    <FilterBlock
      count={shown.pipelines.length + shown.projects.length + shown.tags.length}
      running={running}
      locked={locked}
      onReset={() => void change({ pipelines: [], projects: [], tags: [] })}
    >
      <FilterField
        label={t('queue.filter.pipelines')}
        options={pipelineOptions(pipelines, scoped, shown.pipelines, unknown)}
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
      <FilterField
        label={t('queue.filter.tags')}
        options={tagOptions}
        look={tagLook(grouped, unknown)}
        selected={shown.tags}
        onChange={(values) => void change({ tags: values })}
        clearLabel={t('queue.filter.clear')}
        disabled={locked}
      />
    </FilterBlock>
  );
}
