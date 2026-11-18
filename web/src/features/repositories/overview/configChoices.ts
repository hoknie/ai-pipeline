import type { ConfigEditorResponse, EntryLevel } from '../../../shared/api/types.ts';
import type { Grouped, ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';

/** The value of the choice of the shared entry. */
export const SHARED_CHOICE = '*shared';

/**
 * One configuration of an entry to look at: the shared one or a project's own. `project` is
 * where it is read and opened; for the shared one, a project that uses it as it is when one does.
 */
export interface ConfigChoice {
  value: string;
  project: ProjectRef;
  level: EntryLevel;
}

type Row = Grouped<{ level: EntryLevel }>;

function byLabel(left: ConfigChoice, right: ConfigChoice): number {
  const names = left.project.label.toLowerCase().localeCompare(right.project.label.toLowerCase());
  if (names !== 0) return names;
  return left.project.path < right.project.path
    ? -1
    : left.project.path > right.project.path
      ? 1
      : 0;
}

/**
 * The shared entry first (when there is one), then the projects with their own entry by name:
 * projects that use the shared entry as it is are not choices of their own.
 */
export function configChoices(row: Row, highlight: string | null): ConfigChoice[] {
  const choices: ConfigChoice[] = [];
  if (row.presences.some((p) => p.entry.level !== 'project')) {
    const users = row.presences.filter((p) => p.entry.level === 'global');
    const host =
      users.find((p) => p.project.slug === highlight) ??
      users[0] ??
      row.presences.find((p) => p.entry.level !== 'project')!;
    choices.push({ value: SHARED_CHOICE, project: host.project, level: 'global' });
  }
  const own: ConfigChoice[] = [];
  for (const { project, entry } of row.presences) {
    if (entry.level !== 'global') own.push({ value: project.slug, project, level: entry.level });
  }
  return [...choices, ...own.sort(byLabel)];
}

/** The choice shown at first: the project of the address, the shared entry it uses, else the first. */
export function initialChoice(
  choices: readonly ConfigChoice[],
  row: Row,
  highlight: string | null,
) {
  const own = choices.find((choice) => choice.value === highlight);
  if (own) return own;
  const usesShared = row.presences.some(
    (p) => p.project.slug === highlight && p.entry.level === 'global',
  );
  const shared = choices.find((choice) => choice.value === SHARED_CHOICE);
  return (usesShared ? shared : undefined) ?? choices[0] ?? null;
}

/** The choices whose project name or slug contains the text; the shared one always stays. */
export function filterChoices(choices: readonly ConfigChoice[], query: string): ConfigChoice[] {
  const text = query.trim().toLowerCase();
  if (text === '') return [...choices];
  return choices.filter(
    (choice) =>
      choice.value === SHARED_CHOICE ||
      choice.project.label.toLowerCase().includes(text) ||
      choice.project.slug.toLowerCase().includes(text),
  );
}

type Source = { file: string; revision: string; raw: Record<string, unknown> };
type Replaceable = {
  level: EntryLevel;
  sources: { global?: Source };
};

/** The collections of a view whose entries have a shared file. */
export type SharedCollection = 'specialists' | 'chains' | 'pipelines' | 'actions';

/**
 * The view of a project with the entry replaced by its shared file, for the shared choice.
 * `key` is the slug of a specialist or chain, the id of a pipeline or action.
 */
export function sharedView(
  view: ConfigEditorResponse,
  collection: SharedCollection,
  key: string,
): ConfigEditorResponse {
  const toShared = (entry: Replaceable & Record<string, unknown>) => {
    const shared = entry.sources.global;
    const entryKey =
      collection === 'specialists' || collection === 'chains' ? entry.slug : entry.id;
    if (entryKey !== key || entry.level === 'global' || !shared) return entry;
    return {
      ...entry,
      level: 'global',
      file: shared.file,
      revision: shared.revision,
      raw: shared.raw,
      sources: { global: shared },
    };
  };
  const list = (view as unknown as Record<string, unknown>)[collection];
  if (!Array.isArray(list)) return view;
  return { ...view, [collection]: list.map(toShared) } as ConfigEditorResponse;
}
