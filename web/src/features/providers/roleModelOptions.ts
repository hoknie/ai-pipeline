import type { ProviderView, RoleView } from '../../shared/api/types.ts';

/** A model of a role at a provider, ready to be the model of a chain item. */
export interface RoleModelOption {
  role: string;
  name: string;
  /** The full id: the prefix of the access, then the model. */
  model: string;
}

/**
 * The models of the roles of a provider for an item of a chain that runs it through `runtime`: the
 * model of the first CLI access of that runtime (else the one of the provider) with the prefix of
 * that access. A provider without such an access, and a role without a model, give nothing.
 */
export function roleModelOptions(
  provider: ProviderView,
  roles: readonly RoleView[],
  runtime: string,
): RoleModelOption[] {
  const access = provider.access.find((item) => item.kind === 'cli' && item.runtime === runtime);
  if (!access) return [];
  return roles.flatMap((role): RoleModelOption[] => {
    const record = access.models[role.slug] ?? provider.models[role.slug];
    const model = record?.model.trim() ?? '';
    if (model === '') return [];
    const full = access.modelPrefix ? `${access.modelPrefix}/${model}` : model;
    return [{ role: role.slug, name: role.name, model: full }];
  });
}
