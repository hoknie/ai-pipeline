import { existingSelection, filterSpecialists, repositoryTags } from './specialistTags.ts';
import type { EditorSpecialist } from '../../shared/api/types.ts';

export type LevelFilter = 'all' | 'project' | 'global';

/** What the specialists list is narrowed by; the search text lives apart from it. */
export interface SpecialistFilter {
  level: LevelFilter;
  tags: string[];
  runtimes: string[];
  models: string[];
  skills: string[];
  tools: string[];
  commands: string[];
}

export const EMPTY_FILTER: SpecialistFilter = {
  level: 'all',
  tags: [],
  runtimes: [],
  models: [],
  skills: [],
  tools: [],
  commands: [],
};

type ListField = 'runtimes' | 'models' | 'skills' | 'tools' | 'commands';
export const LIST_FIELDS: ListField[] = ['runtimes', 'models', 'skills', 'tools', 'commands'];

type Entry = Pick<
  EditorSpecialist,
  'slug' | 'level' | 'raw' | 'effective' | 'shared_tags' | 'own_tags'
>;

export interface SpecialistValues {
  name: string | null;
  runtime: string | null;
  model: string | null;
  skills: string[];
  tools: string[];
  commands: string[];
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The values to filter by: after defaults, or the raw file when the specialist is invalid. */
export function specialistValues(entry: Entry): SpecialistValues {
  if (entry.effective) {
    return {
      name: entry.effective.name,
      runtime: entry.effective.runtime,
      model: entry.effective.model,
      skills: entry.effective.skills,
      tools: entry.effective.tools,
      commands: entry.effective.allow_commands,
    };
  }
  return {
    name: text(entry.raw.name),
    runtime: text(entry.raw.runtime),
    model: text(entry.raw.model),
    skills: texts(entry.raw.skills),
    tools: texts(entry.raw.tools),
    commands: texts(entry.raw.allow_commands),
  };
}

export interface FilterOptions {
  tags: { name: string; shared: boolean }[];
  runtimes: string[];
  models: string[];
  skills: string[];
  tools: string[];
  commands: string[];
}

const unique = (values: string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));

/** The choices of every filter: distinct values of the specialists, sorted by name. */
export function filterOptions(entries: readonly Entry[]): FilterOptions {
  const all = entries.map(specialistValues);
  const nonEmpty = (values: (string | null)[]) =>
    values.filter((value): value is string => value !== null);
  return {
    tags: repositoryTags(entries),
    runtimes: unique(nonEmpty(all.map((value) => value.runtime))),
    models: unique(nonEmpty(all.map((value) => value.model))),
    skills: unique(all.flatMap((value) => value.skills)),
    tools: unique(all.flatMap((value) => value.tools)),
    commands: unique(all.flatMap((value) => value.commands)),
  };
}

/** Whether the text is part of the slug or the name; case and edge spaces do not matter. */
export function matchesSearch(entry: Entry, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (needle === '') return true;
  const name = specialistValues(entry).name ?? '';
  return (
    entry.slug.toLocaleLowerCase().includes(needle) || name.toLocaleLowerCase().includes(needle)
  );
}

/** A specialist overriding a shared one has files of both levels and fits both. */
export function matchesLevel(filter: LevelFilter, level: EditorSpecialist['level']): boolean {
  if (filter === 'all') return true;
  return level === 'project_over_global' || level === filter;
}

const FIELD_VALUES: Record<ListField, (values: SpecialistValues) => string[]> = {
  runtimes: (values) => (values.runtime ? [values.runtime] : []),
  models: (values) => (values.model ? [values.model] : []),
  skills: (values) => values.skills,
  tools: (values) => values.tools,
  commands: (values) => values.commands,
};

/** Any of the chosen values inside one filter, all filters together; the order is kept. */
export function applyFilter<T extends Entry>(
  entries: readonly T[],
  filter: SpecialistFilter,
  search: string,
): T[] {
  const byTags = filterSpecialists(entries, filter.tags);
  return byTags.filter((entry) => {
    if (!matchesSearch(entry, search) || !matchesLevel(filter.level, entry.level)) return false;
    const values = specialistValues(entry);
    return LIST_FIELDS.every((field) => {
      const chosen = filter[field];
      if (chosen.length === 0) return true;
      const own = FIELD_VALUES[field](values);
      return chosen.some((value) => own.includes(value));
    });
  });
}

/** The filter without the values nobody has any more. */
export function existingFilter(filter: SpecialistFilter, options: FilterOptions): SpecialistFilter {
  const next: SpecialistFilter = {
    ...filter,
    tags: existingSelection(filter.tags, options.tags),
  };
  for (const field of LIST_FIELDS) {
    next[field] = filter[field].filter((value) => options[field].includes(value));
  }
  return next;
}

/** How many filters narrow the list: the search, the level and every non-empty list. */
export function activeFilterCount(filter: SpecialistFilter, search = ''): number {
  return (
    (search.trim() === '' ? 0 : 1) +
    (filter.level === 'all' ? 0 : 1) +
    (filter.tags.length > 0 ? 1 : 0) +
    LIST_FIELDS.filter((field) => filter[field].length > 0).length
  );
}
