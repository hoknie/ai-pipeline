import { matchesLevel, type LevelFilter } from './specialistFilters.ts';
import { existingSelection, filterSpecialists, repositoryTags } from './specialistTags.ts';
import type { EditorWorkflow } from './types.ts';

/** What the pipelines list is narrowed by; the search text lives apart from it. */
export interface WorkflowFilter {
  level: LevelFilter;
  tags: string[];
  specialists: string[];
}

export const EMPTY_WORKFLOW_FILTER: WorkflowFilter = { level: 'all', tags: [], specialists: [] };

type Entry = Pick<EditorWorkflow, 'id' | 'level' | 'raw' | 'shared_tags' | 'own_tags'>;

export interface WorkflowFilterOptions {
  tags: { name: string; shared: boolean }[];
  specialists: string[];
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The specialists a pipeline names: its steps and the one that splits the work. */
export function specialistsOfWorkflow(entry: Pick<EditorWorkflow, 'raw'>): string[] {
  const names: string[] = [];
  const steps = Array.isArray(entry.raw.steps) ? entry.raw.steps : [];
  for (const step of steps) {
    const specialist = record(step).specialist;
    if (typeof specialist === 'string' && specialist !== '') names.push(specialist);
  }
  const split = record(entry.raw.split).specialist;
  if (typeof split === 'string' && split !== '') names.push(split);
  return [...new Set(names)];
}

/** The choices of every filter: tags and specialists of the pipelines, sorted by name. */
export function workflowFilterOptions(entries: readonly Entry[]): WorkflowFilterOptions {
  const specialists = [...new Set(entries.flatMap(specialistsOfWorkflow))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { tags: repositoryTags(entries), specialists };
}

/** Whether the text is part of the id or the name; case and edge spaces do not matter. */
export function matchesWorkflowSearch(entry: Entry, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (needle === '') return true;
  const name = typeof entry.raw.name === 'string' ? entry.raw.name : '';
  return entry.id.toLocaleLowerCase().includes(needle) || name.toLocaleLowerCase().includes(needle);
}

/** Any of the chosen values inside one filter, all filters together; the order is kept. */
export function applyWorkflowFilter<T extends Entry>(
  entries: readonly T[],
  filter: WorkflowFilter,
  search: string,
): T[] {
  return filterSpecialists(entries, filter.tags).filter((entry) => {
    if (!matchesWorkflowSearch(entry, search) || !matchesLevel(filter.level, entry.level)) {
      return false;
    }
    if (filter.specialists.length === 0) return true;
    const own = specialistsOfWorkflow(entry);
    return filter.specialists.some((name) => own.includes(name));
  });
}

/** The filter without the values nobody has any more. */
export function existingWorkflowFilter(
  filter: WorkflowFilter,
  options: WorkflowFilterOptions,
): WorkflowFilter {
  return {
    ...filter,
    tags: existingSelection(filter.tags, options.tags),
    specialists: filter.specialists.filter((name) => options.specialists.includes(name)),
  };
}

/** How many filters narrow the list: the search, the level, the tags and the specialists. */
export function activeWorkflowFilterCount(filter: WorkflowFilter, search = ''): number {
  return (
    (search.trim() === '' ? 0 : 1) +
    (filter.level === 'all' ? 0 : 1) +
    (filter.tags.length > 0 ? 1 : 0) +
    (filter.specialists.length > 0 ? 1 : 0)
  );
}

/** Only the well-formed parts of a saved choice are used. */
export function savedWorkflowFilter(saved: unknown): WorkflowFilter {
  if (typeof saved !== 'object' || saved === null) return EMPTY_WORKFLOW_FILTER;
  const value = saved as Record<string, unknown>;
  const strings = (item: unknown): string[] =>
    Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : [];
  const level = value.level;
  return {
    level: level === 'project' || level === 'global' ? level : 'all',
    tags: strings(value.tags),
    specialists: strings(value.specialists),
  };
}
