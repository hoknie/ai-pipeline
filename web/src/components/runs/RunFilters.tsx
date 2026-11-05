import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../repositories.ts';
import { statusInfo } from '../../status.ts';
import { useTags } from '../../tags.tsx';
import type { RunView } from '../../types.ts';
import { Input } from '../../ui/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.tsx';
import { FilterSelect, type FilterOption } from '../FilterSelect.tsx';
import { TagLabel } from '../TagChip.tsx';

import {
  RUN_STATES,
  optionCounts,
  runSpecialists,
  runsOf,
  type RunFilterKey,
  type RunFilterState,
  type RunScope,
} from './runFilter.ts';

/** Search, repository switch and the multiselect filters of the run list. */
export function RunFilters({
  runs,
  query,
  onQuery,
  filters,
  onFilters,
  scope,
  onScope,
  repository,
  repositoryPaths,
}: {
  runs: RunView[];
  query: string;
  onQuery: (query: string) => void;
  filters: RunFilterState;
  onFilters: (filters: RunFilterState) => void;
  /** Whose runs the list shows: those of the selected repository or of every one. */
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  /** The path of each repository as shown; absent: the path itself. */
  repositoryPaths?: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const { byId, of } = useTags();
  const counts = (key: RunFilterKey) =>
    optionCounts(runs, query, filters, scope, repository, byId, key);
  const scoped = runsOf(runs, scope === 'repository' ? repository : null);
  const set = (key: RunFilterKey) => (values: string[]) => onFilters({ ...filters, [key]: values });

  const stateCounts = counts('states');
  const states: FilterOption[] = RUN_STATES.map((state) => ({
    value: state,
    label: statusInfo(state, t).label,
    count: stateCounts.get(state) ?? 0,
  }));

  const workflowCounts = counts('workflows');
  const workflows = new Map<string, string>();
  for (const run of scoped) workflows.set(run.workflow, run.workflowName || run.workflow);
  for (const id of filters.workflows) if (!workflows.has(id)) workflows.set(id, id);
  const workflowOptions: FilterOption[] = [...workflows]
    .map(([value, label]) => ({ value, label, count: workflowCounts.get(value) ?? 0 }))
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
      count: repositoryCounts.get(path) ?? 0,
    }))
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.hint.localeCompare(right.hint),
    );

  const clear = t('runs.list.clear');
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t('runs.list.search')}
        placeholder={t('runs.list.search')}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <ToggleGroup
        type="single"
        aria-label={t('runs.list.scope')}
        value={scope}
        className="flex-wrap"
        onValueChange={(value) => value && onScope(value as RunScope)}
      >
        <ToggleGroupItem value="repository">{t('runs.list.scopeRepository')}</ToggleGroupItem>
        <ToggleGroupItem value="all">{t('runs.list.scopeAll')}</ToggleGroupItem>
      </ToggleGroup>
      <FilterSelect
        label={t('runs.list.state')}
        options={states}
        selected={filters.states}
        onChange={set('states')}
        clearLabel={clear}
      />
      <FilterSelect
        label={t('runs.list.workflow')}
        options={workflowOptions}
        selected={filters.workflows}
        onChange={set('workflows')}
        clearLabel={clear}
      />
      <FilterSelect
        label={t('runs.list.specialists')}
        options={specialistOptions}
        selected={filters.specialists}
        onChange={set('specialists')}
        clearLabel={clear}
      />
      <FilterSelect
        label={t('runs.list.tags')}
        options={tagOptions}
        selected={filters.tagIds}
        onChange={set('tagIds')}
        clearLabel={clear}
      />
      {scope === 'all' ? (
        <FilterSelect
          label={t('runs.list.repositories')}
          options={repositoryOptions}
          selected={filters.repositories}
          onChange={set('repositories')}
          clearLabel={clear}
        />
      ) : null}
    </div>
  );
}
