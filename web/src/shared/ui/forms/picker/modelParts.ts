import type { ModelEntry } from '../../../api/types.ts';

/** The models whose id or short name contains the typed text, ignoring case. */
export function matchingModels<T extends ModelEntry>(models: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return models;
  return models.filter(
    (model) => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle),
  );
}

export interface ModelGroup<T extends ModelEntry = ModelEntry> {
  group: string;
  models: T[];
}

/** The models by group, in the order the groups first appear. */
export function groupModels<T extends ModelEntry>(models: T[]): ModelGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const model of models) {
    const list = groups.get(model.group);
    if (list) list.push(model);
    else groups.set(model.group, [model]);
  }
  return [...groups].map(([group, list]) => ({ group, models: list }));
}
