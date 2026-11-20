import { useTranslation } from 'react-i18next';

import type { Api, IntegrationsOverview } from '../../../shared/api/api.ts';
import type { RepositoryView } from '../../../shared/api/types.ts';

import { ConnectionCard } from '../connections/ConnectionCard.tsx';
import { NewConnectionForm } from '../connections/NewConnectionForm.tsx';
import { channelsOf, connectionActions, type Done } from '../connections/useConnectionActions.ts';
import { RegistryLinks } from './RegistryLinks.tsx';

/** The kind of the connections of this tab. */
export const REGISTRY_KIND = 'service-registry';

/**
 * The service registries: the form of a new connection, a card for each (url, token status and
 * the check with its last outcome) and the links of the projects.
 */
export function RegistryTab({
  api,
  overview,
  registry,
  done,
  version,
}: {
  api: Api;
  overview: IntegrationsOverview;
  registry: readonly RepositoryView[];
  done: Done;
  version: number;
}) {
  const { t } = useTranslation();
  const actions = connectionActions(api, done);
  const channels = channelsOf(overview);
  const connections = overview.connections.filter((one) => one.kind === REGISTRY_KIND);
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3" aria-labelledby="registry-title">
        <h2 id="registry-title" className="text-base font-semibold">
          {t('integrations.registry.title')}
        </h2>
        <NewConnectionForm
          types={overview.types}
          registry={registry}
          only={REGISTRY_KIND}
          onCreate={actions.onCreate}
        />
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('integrations.registry.empty')}</p>
        ) : (
          connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              type={overview.types.find((type) => type.kind === connection.kind)}
              channel={channels.get(connection.id) ?? null}
              onEdit={actions.onEdit}
              onEnabled={actions.onEnabled}
              onRemove={actions.onRemove}
              onCheck={actions.onCheck}
            />
          ))
        )}
      </section>
      {connections.length === 0 ? null : (
        <RegistryLinks api={api} registry={registry} version={version} />
      )}
    </div>
  );
}
