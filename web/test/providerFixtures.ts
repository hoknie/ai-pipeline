import type {
  AccessModels,
  AccessState,
  EditorProvider,
  MatrixCell,
  ProviderModelsView,
  ProvidersView,
  ProviderView,
  RoleModels,
  RoleView,
} from '../src/shared/api/types.ts';

/** A route of a provider that is available (CLI `claude` unless said otherwise). */
export function accessState(overrides: Partial<AccessState> = {}): AccessState {
  return {
    index: 0,
    kind: 'cli',
    runtime: 'claude',
    enabled: true,
    command: 'claude',
    modelPrefix: null,
    endpoint: null,
    available: true,
    reasons: [],
    ...overrides,
  };
}

/** A provider of the registry with one available route. */
export function providerView(slug: string, overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    slug,
    name: slug,
    level: 'global',
    file: `/xdg/aip/providers/${slug}.yaml`,
    enabled: true,
    status: 'available',
    active: 0,
    access: [{ ...accessState(), models: {} }],
    models: {},
    limitUntil: null,
    ...overrides,
  };
}

export function roleView(slug: string, name = slug, level: RoleView['level'] = 'global'): RoleView {
  return { slug, name, level };
}

/** The registry view; the matrix follows the roles and providers unless given. */
export function providersView(overrides: Partial<ProvidersView> = {}): ProvidersView {
  const view: ProvidersView = {
    repository: '/repo',
    errors: [],
    roles: [],
    providers: [],
    defaultProvider: null,
    matrix: [],
    ...overrides,
  };
  if (overrides.matrix === undefined) {
    view.matrix = view.roles.flatMap((role): MatrixCell[] =>
      view.providers.map((provider) => ({
        role: role.slug,
        provider: provider.slug,
        model: provider.models[role.slug] ?? null,
        access: provider.access.map((access) => ({
          index: access.index,
          model: access.models[role.slug] ?? provider.models[role.slug] ?? null,
        })),
      })),
    );
  }
  return view;
}

/** The editor record of a provider: the file of its level with a revision. */
export function editorProvider(
  slug: string,
  raw: Record<string, unknown>,
  level: 'global' | 'project' = 'global',
  revision = `${slug}-r1`,
): EditorProvider {
  const file = `/${level === 'global' ? 'xdg' : 'repo'}/aip/providers/${slug}.yaml`;
  return {
    slug,
    level,
    file,
    revision: level === 'project' ? revision : null,
    raw,
    sources: { [level]: { file, revision, raw } },
    effective: null,
  };
}

/** The models of a provider by access. */
export function providerModelsView(
  provider: string,
  access: Partial<AccessModels>[] = [{}],
): ProviderModelsView {
  return {
    repository: '/repo',
    provider,
    access: access.map((item, index) => ({
      index,
      runtime: 'claude',
      models: [],
      error: null,
      manual: false,
      ...item,
    })),
  };
}

export const roleModels = (value: RoleModels): RoleModels => value;
