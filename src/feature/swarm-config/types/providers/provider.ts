import { type ReasoningEffort, type Runtime, type SpecialistLevel } from '../specialist.ts';

/** A named role of a model ("think", "code"): the rows of the role × provider matrix. */
export interface Role {
  slug: string;
  name: string;
  level: SpecialistLevel;
}

/** The model of a role at a provider, with the options OpenCode takes. */
export interface RoleModel {
  model: string;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
}

/** Models by role slug; a role without a record is an empty cell of the matrix. */
export type RoleModels = Record<string, RoleModel>;

/** The place of a key: the name of an environment variable, never the value. */
export interface AccessEndpoint {
  baseUrl: string;
  keyEnv: string;
}

/** An agent CLI route to the provider. */
export interface CliAccess {
  kind: 'cli';
  runtime: Runtime;
  enabled: boolean;
  /** The provider (or the prefix of the model) the CLI addresses: `gproxy/glmcode` of `gproxy/glmcode/GLM-5.3`. */
  modelPrefix?: string;
  endpoint?: AccessEndpoint;
  /** Replaces `runtimes.<runtime>.command` for this route; the shared level only. */
  command?: string;
  args?: string[];
  /** Overrides the models of the provider for this route. */
  models: RoleModels;
}

/** A direct API channel: only a place in the schema, never available. */
export interface ApiAccess {
  kind: 'api';
  enabled: boolean;
  endpoint?: AccessEndpoint;
  models: RoleModels;
}

export type ProviderAccess = CliAccess | ApiAccess;

export interface Provider {
  slug: string;
  name: string;
  enabled: boolean;
  /** Routes in the order of preference; the effective one is the first available. */
  access: ProviderAccess[];
  models: RoleModels;
  level: SpecialistLevel;
}

export interface ProviderRegistry {
  providers: readonly Provider[];
}

/** Providers of the configuration, disabled ones included, sorted by slug. */
export function knownProviders(config: ProviderRegistry): Provider[] {
  return [...config.providers].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The human name of the provider; null when the configuration does not know it. */
export function providerName(config: Partial<ProviderRegistry>, slug: string): string | null {
  return config.providers?.find((provider) => provider.slug === slug)?.name ?? null;
}

/** `<slug> (<name>)`, or only the slug when the name is unknown. */
export function providerLabel(name: string | null | undefined, slug: string): string {
  return name ? `${slug} (${name})` : slug;
}

/** The error of a provider the configuration does not know, listing the known ones with names. */
export function unknownProviderMessage(config: ProviderRegistry, provider: string): string {
  const list = knownProviders(config)
    .map((item) => providerLabel(item.name, item.slug))
    .join(', ');
  return `unknown provider \`${provider}\`; known: ${list || 'none'}`;
}

/** The error of a provider the configuration does not know or has switched off; null when usable. */
export function providerProblem(config: ProviderRegistry, provider: string): string | null {
  const found = config.providers.find((item) => item.slug === provider);
  if (found === undefined) return unknownProviderMessage(config, provider);
  return found.enabled ? null : `provider \`${provider}\` is disabled`;
}

/** The provider new tasks start on: the `default_provider` when the registry has it enabled, else null. */
export function defaultProviderOf(config: {
  providers: readonly Provider[];
  defaultProvider?: { slug: string } | null;
}): string | null {
  const slug = config.defaultProvider?.slug;
  if (slug === undefined) return null;
  return config.providers.some((provider) => provider.slug === slug && provider.enabled)
    ? slug
    : null;
}

/** The model of a role for a route: the record of the route, else the record of the provider. */
export function roleModelOf(
  provider: Pick<Provider, 'models'>,
  access: ProviderAccess,
  role: string,
): RoleModel | null {
  const own = Object.hasOwn(access.models, role) ? access.models[role] : undefined;
  const record = own ?? (Object.hasOwn(provider.models, role) ? provider.models[role] : undefined);
  if (record === undefined) return null;
  const prefix = access.kind === 'cli' ? access.modelPrefix : undefined;
  return { ...record, model: prefix ? `${prefix}/${record.model}` : record.model };
}

/** Roles and providers missing in a snapshot of an older build are empty. */
export function withRegistryDefaults(stored: { providers?: Provider[]; roles?: Role[] }): {
  providers: Provider[];
  roles: Role[];
} {
  return {
    providers: (stored.providers ?? []).map((provider) => ({
      ...provider,
      level: provider.level ?? 'project',
    })),
    roles: (stored.roles ?? []).map((role) => ({ ...role, level: role.level ?? 'project' })),
  };
}
