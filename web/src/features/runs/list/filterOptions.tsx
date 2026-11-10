import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { statusInfo } from '../../../shared/lib/status.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import type { RunView } from '../../../shared/api/types.ts';
import type { FilterOption } from '../../../shared/ui/forms/filters/FilterField.tsx';
import { TagLabel } from '../../../shared/ui/feedback/TagChip.tsx';
import {
  RUN_STATES,
  optionCounts,
  runSpecialists,
  runsOf,
  type RunFilterKey,
  type RunFilterState,
  type RunScope,
} from './runFilter.ts';

interface FilterOptionsInput {
  runs: RunView[];
  query: string;
  filters: RunFilterState;
  scope: RunScope;
  repository: string | null;
  repositoryPaths?: ReadonlyMap<string, string>;
}

/** The options of the multiselect filters, each with the count of runs it would leave. */
export function useFilterOptions(input: FilterOptionsInput) {
  const { runs, query, filters, scope, repository, repositoryPaths } = input;
  const { t } = useTranslation();
  const { byId, of } = useTags();
  const counts = (key: RunFilterKey) =>
    optionCounts(runs, query, filters, scope, repository, byId, key);
  const scoped = runsOf(runs, scope === 'repository' ? repository : null);

  const stateCounts = counts('states');
  const states: FilterOption[] = RUN_STATES.map((state) => ({
    value: state,
    label: statusInfo(state, t).label,
    count: stateCounts.get(state) ?? 0,
  }));

  const pipelineCounts = counts('pipelines');
  const pipelines = new Map<string, string>();
  for (const run of scoped) pipelines.set(run.pipeline, run.pipelineName || run.pipeline);
  for (const id of filters.pipelines) if (!pipelines.has(id)) pipelines.set(id, id);
  const pipelineOptions: FilterOption[] = [...pipelines]
    .map(([value, label]) => ({ value, label, count: pipelineCounts.get(value) ?? 0 }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const specialistCounts = counts('specialists');
  const specialists = new Set<string>(filters.specialists);
  for (const run of scoped) runSpecialists(run).forEach((slug) => specialists.add(slug));
  const specialistOptions: FilterOption[] = [...specialists]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value, count: specialistCounts.get(value) ?? 0 }));

  const tagCounts = counts('tagIds');
  const tagOptions: FilterOption[] = of(repository).map((tag) => ({
    value: tag.id,
    label: tag.name,
    count: tagCounts.get(tag.id) ?? 0,
    render: <TagLabel tag={tag} />,
  }));

  const repositoryCounts = counts('repositories');
  const repositories = new Set<string>([...filters.repositories, ...runs.map((r) => r.repository)]);
  const repositoryOptions: FilterOption[] = [...repositories]
    .map((path) => ({
      value: path,
      label: repositoryLabel(path),
      hint: repositoryPaths?.get(path) ?? path,
      render: (
        <span className="inline-flex items-center gap-1.5">
          <ProjectDot path={path} />
          {repositoryLabel(path)}
        </span>
      ),
      count: repositoryCounts.get(path) ?? 0,
    }))
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.hint.localeCompare(right.hint),
    );

  return {
    states,
    pipelines: pipelineOptions,
    specialists: specialistOptions,
    tags: tagOptions,
    repositories: repositoryOptions,
  };
}
