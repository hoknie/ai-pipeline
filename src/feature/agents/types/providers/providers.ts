import type {
  AccessEndpoint,
  Provider,
  ProviderAccess,
  Role,
  RoleModel,
  Runtime,
} from '../../../swarm-config/types/index.ts';
import { roleModelOf } from '../../../swarm-config/types/index.ts';

import type { ModelEntry } from '../models.ts';

export const PROVIDER_STATUSES = ['available', 'unavailable', 'disabled'] as const;

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** What the daemon found out about one route to a provider; no value of a variable is here. */
export interface AccessFacts {
  accessEnabled: boolean;
  /** `null` for a route without an agent CLI. */
  runtime: Runtime | null;
  runtimeEnabled: boolean;
  command: string | null;
  commandFound: boolean;
  keyEnv: string | null;
  keySet: boolean;
}

export interface AccessState {
  index: number;
  kind: 'cli' | 'api';
  runtime: Runtime | null;
  enabled: boolean;
  command: string | null;
  modelPrefix: string | null;
  endpoint: AccessEndpoint | null;
  available: boolean;
  reasons: string[];
}

export interface ProviderState {
  slug: string;
  name: string;
  level: Provider['level'];
  enabled: boolean;
  status: ProviderStatus;
  /** Index of the first available route; null when there is none. */
  active: number | null;
  access: AccessState[];
}

export const API_NOT_IMPLEMENTED = 'api access is not implemented';

/** Why a route is not available, all reasons in a fixed order; empty when it is available. */
export function accessReasons(facts: AccessFacts): string[] {
  const reasons: string[] = [];
  if (!facts.accessEnabled) reasons.push('access disabled');
  if (facts.runtime === null) {
    reasons.push(API_NOT_IMPLEMENTED);
    return reasons;
  }
  if (!facts.runtimeEnabled) reasons.push(`runtime ${facts.runtime} is disabled`);
  if (!facts.commandFound) reasons.push(`command ${facts.command ?? facts.runtime} not found`);
  if (facts.keyEnv !== null && !facts.keySet) reasons.push(`variable ${facts.keyEnv} is not set`);
  return reasons;
}

export function accessState(
  index: number,
  access: ProviderAccess,
  facts: AccessFacts,
): AccessState {
  const reasons = accessReasons(facts);
  return {
    index,
    kind: access.kind,
    runtime: access.kind === 'cli' ? access.runtime : null,
    enabled: access.enabled,
    command: facts.command,
    modelPrefix: access.kind === 'cli' ? (access.modelPrefix ?? null) : null,
    endpoint: access.endpoint ?? null,
    available: reasons.length === 0,
    reasons,
  };
}

/** `disabled` for a switched-off provider, else `available` with one available route. */
export function providerStatus(
  enabled: boolean,
  access: readonly Pick<AccessState, 'available'>[],
): { status: ProviderStatus; active: number | null } {
  const first = access.findIndex((item) => item.available);
  const active = first >= 0 ? first : null;
  if (!enabled) return { status: 'disabled', active };
  return { status: active === null ? 'unavailable' : 'available', active };
}

/** One cell of the role × provider matrix; `model` is null for an empty cell. */
export interface MatrixCell {
  role: string;
  provider: string;
  /** The record of the provider, without the prefix of a route. */
  model: RoleModel | null;
  /** The model of the role at each route of the provider, with the full ID. */
  access: { index: number; model: RoleModel | null }[];
}

/** The cells in the order of the roles, then of the providers. */
export function modelMatrix(roles: readonly Role[], providers: readonly Provider[]): MatrixCell[] {
  return roles.flatMap((role) =>
    providers.map((provider) => ({
      role: role.slug,
      provider: provider.slug,
      model: Object.hasOwn(provider.models, role.slug) ? provider.models[role.slug]! : null,
      access: provider.access.map((access, index) => ({
        index,
        model: roleModelOf(provider, access, role.slug),
      })),
    })),
  );
}

/** The roles an enabled provider has no model for, at any route. */
export function emptyRoles(roles: readonly Role[], provider: Provider): string[] {
  return roles
    .filter(
      (role) =>
        !Object.hasOwn(provider.models, role.slug) &&
        provider.access.every((access) => !Object.hasOwn(access.models, role.slug)),
    )
    .map((role) => role.slug);
}

/** The models of one route of a provider; `manual`: the model is typed by hand. */
export interface AccessModels {
  index: number;
  runtime: Runtime | null;
  models: ModelEntry[];
  error: string | null;
  manual: boolean;
}
