import { matchesLevel, type LevelFilter } from '../specialists/index.ts';
import { existingSelection, filterSpecialists, repositoryTags } from '../specialists/index.ts';
import type { EditorPipeline } from '../../shared/api/types.ts';

/** What the pipelines list is narrowed by; the search text lives apart from it. */
export interface PipelineFilter {
  level: LevelFilter;
  tags: string[];
  specialists: string[];
}

export const EMPTY_PIPELINE_FILTER: PipelineFilter = { level: 'all', tags: [], specialists: [] };

type Entry = Pick<EditorPipeline, 'id' | 'level' | 'raw' | 'shared_tags' | 'own_tags'>;

export interface PipelineFilterOptions {
  tags: { name: string; shared: boolean }[];
  specialists: string[];
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The specialists a pipeline names: its steps and the one that splits the work. */
export function specialistsOfPipeline(entry: Pick<EditorPipeline, 'raw'>): string[] {
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
export function pipelineFilterOptions(entries: readonly Entry[]): PipelineFilterOptions {
  const specialists = [...new Set(entries.flatMap(specialistsOfPipeline))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { tags: repositoryTags(entries), specialists };
}

/** Whether the text is part of the id or the name; case and edge spaces do not matter. */
export function matchesPipelineSearch(entry: Entry, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (needle === '') return true;
  const name = typeof entry.raw.name === 'string' ? entry.raw.name : '';
  return entry.id.toLocaleLowerCase().includes(needle) || name.toLocaleLowerCase().includes(needle);
}

/** Any of the chosen values inside one filter, all filters together; the order is kept. */
export function applyPipelineFilter<T extends Entry>(
  entries: readonly T[],
  filter: PipelineFilter,
  search: string,
): T[] {
  return filterSpecialists(entries, filter.tags).filter((entry) => {
    if (!matchesPipelineSearch(entry, search) || !matchesLevel(filter.level, entry.level)) {
      return false;
    }
    if (filter.specialists.length === 0) return true;
    const own = specialistsOfPipeline(entry);
    return filter.specialists.some((name) => own.includes(name));
  });
}

/** The filter without the values nobody has any more. */
export function existingPipelineFilter(
  filter: PipelineFilter,
  options: PipelineFilterOptions,
): PipelineFilter {
  return {
    ...filter,
    tags: existingSelection(filter.tags, options.tags),
    specialists: filter.specialists.filter((name) => options.specialists.includes(name)),
  };
}

/** How many filters narrow the list: the search, the level, the tags and the specialists. */
export function activePipelineFilterCount(filter: PipelineFilter, search = ''): number {
  return (
    (search.trim() === '' ? 0 : 1) +
    (filter.level === 'all' ? 0 : 1) +
    (filter.tags.length > 0 ? 1 : 0) +
    (filter.specialists.length > 0 ? 1 : 0)
  );
}

/** Only the well-formed parts of a saved choice are used. */
export function savedPipelineFilter(saved: unknown): PipelineFilter {
  if (typeof saved !== 'object' || saved === null) return EMPTY_PIPELINE_FILTER;
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
