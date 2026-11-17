import {
  emptyRoles,
  type AccessState,
  type ProviderState,
} from '../../../feature/agents/types/index.ts';
import type { Provider, ResolvedConfig } from '../../../feature/swarm-config/types/index.ts';
import { providerText } from '../../format/providers/index.ts';

function accessLine(access: AccessState): string {
  const target = access.runtime ?? 'api';
  const prefix = access.modelPrefix === null ? '' : ` prefix ${access.modelPrefix}`;
  const key = access.endpoint === null ? '' : `, key variable ${access.endpoint.keyEnv}`;
  const state = access.available ? 'available' : `unavailable (${access.reasons.join('; ')})`;
  return `    ${access.index + 1}. ${access.kind} ${target}${prefix}${key}: ${state}`;
}

function modelsLine(provider: Provider): string {
  const models = Object.entries(provider.models).map(([role, item]) => `${role}=${item.model}`);
  return `    models: ${models.join(', ') || 'none'}`;
}

/** The roles and the providers with their status; no value of a variable is printed. */
export function providerLines(config: ResolvedConfig, states: readonly ProviderState[]): string[] {
  const lines = ['', 'Roles:'];
  if (config.roles.length === 0) lines.push('  none');
  for (const role of config.roles) lines.push(`  ${role.slug}: ${role.name}`);
  lines.push('', 'Providers:');
  if (states.length === 0) lines.push('  none');
  for (const state of states) {
    const provider = config.providers.find((item) => item.slug === state.slug) as Provider;
    lines.push(
      `  ${providerText(state.slug, state.name)} · ${state.level} · ${state.enabled ? 'enabled' : 'disabled'} · ${state.status}`,
      ...state.access.map(accessLine),
      modelsLine(provider),
    );
  }
  return lines;
}

/** An enabled provider without a model for a role leaves an empty cell of the matrix. */
export function providerWarnings(config: ResolvedConfig): string[] {
  return config.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      emptyRoles(config.roles, provider).map(
        (role) => `provider \`${provider.slug}\` has no model for role \`${role}\``,
      ),
    );
}
