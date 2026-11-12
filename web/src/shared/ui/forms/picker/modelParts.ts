import type { ModelEntry } from '../../../api/types.ts';

/** The models whose id or short name contains the typed text, ignoring case. */
export function matchingModels(models: ModelEntry[], query: string): ModelEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return models;
  return models.filter(
    (model) => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle),
  );
}

export interface ModelGroup {
  group: string;
  models: ModelEntry[];
}

/** The models by group, in the order the groups first appear. */
export function groupModels(models: ModelEntry[]): ModelGroup[] {
  const groups = new Map<string, ModelEntry[]>();
  for (const model of models) {
    const list = groups.get(model.group);
    if (list) list.push(model);
    else groups.set(model.group, [model]);
  }
  return [...groups].map(([group, list]) => ({ group, models: list }));
}
