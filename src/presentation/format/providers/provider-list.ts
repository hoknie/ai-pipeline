import type { RoleModel } from '../../../feature/swarm-config/types/index.ts';
import type { ProviderView, ProvidersView } from '../../ipc/contract/index.ts';
import { providerText } from './providers.ts';
import { type Style, plainStyle } from '../style.ts';
import { table } from '../table.ts';

/** The roles with a model at the provider: its own, or the one of any route. */
function filledRoles(view: ProvidersView, provider: ProviderView): string[] {
  return view.matrix
    .filter(
      (cell) =>
        cell.provider === provider.slug &&
        (cell.model !== null || cell.access.some((access) => access.model !== null)),
    )
    .map((cell) => cell.role);
}

export function formatProviderList(view: ProvidersView, style: Style = plainStyle): string {
  if (view.providers.length === 0) return 'No providers yet.';
  return table(
    [
      ['SLUG', 'NAME', 'STATUS', 'ACCESS', 'ROLES'],
      ...view.providers.map((provider) => [
        style.argument(provider.slug),
        view.defaultProvider?.slug === provider.slug ? `${provider.name} · default` : provider.name,
        provider.status,
        (provider.active === null ? undefined : provider.access[provider.active]?.runtime) ?? '—',
        `${filledRoles(view, provider).length}/${view.roles.length}`,
      ]),
    ],
    style,
  );
}

function modelText(model: RoleModel): string {
  const options = [
    ...(model.variant === undefined ? [] : [`variant ${model.variant}`]),
    ...(model.reasoningEffort === undefined ? [] : [`effort ${model.reasoningEffort}`]),
  ];
  return options.length === 0 ? model.model : `${model.model} (${options.join(', ')})`;
}

function accessLines(view: ProvidersView, provider: ProviderView, style: Style): string[] {
  return provider.access.flatMap((access) => {
    const target = access.runtime ?? 'api';
    const prefix = access.modelPrefix === null ? '' : ` · prefix ${access.modelPrefix}`;
    const mark = provider.active === access.index ? ' · effective' : '';
    const lines = [
      `  ${access.index + 1}. ${style.argument(access.kind)} ${target} · ${access.available ? 'available' : 'unavailable'}${mark}${prefix}`,
    ];
    if (access.command !== null) lines.push(`     command: ${access.command}`);
    if (access.endpoint !== null) {
      lines.push(
        `     endpoint: ${access.endpoint.baseUrl} · key variable ${access.endpoint.keyEnv}`,
      );
    }
    for (const reason of access.reasons) lines.push(style.muted(`     - ${reason}`));
    for (const cell of view.matrix) {
      const model = cell.provider === provider.slug ? cell.access[access.index]?.model : null;
      if (model) lines.push(`     ${cell.role}: ${modelText(model)}`);
    }
    return lines;
  });
}

export function formatProvider(
  view: ProvidersView,
  provider: ProviderView,
  style: Style = plainStyle,
): string {
  const empty = view.roles
    .map((role) => role.slug)
    .filter((role) => !filledRoles(view, provider).includes(role));
  return [
    style.title(providerText(provider.slug, provider.name)),
    `Level: ${provider.level}${provider.file === null ? '' : ` (${provider.file})`}`,
    `Enabled: ${provider.enabled ? 'yes' : 'no'}`,
    ...(view.defaultProvider?.slug === provider.slug
      ? [`default: yes (${view.defaultProvider.level})`]
      : []),
    `Status: ${provider.status}`,
    'Access:',
    ...accessLines(view, provider, style),
    `Empty roles: ${empty.length === 0 ? 'none' : empty.join(', ')}`,
  ].join('\n');
}
