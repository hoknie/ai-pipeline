import { useTranslation } from 'react-i18next';

import type { Api, IntegrationsOverview } from '../../../shared/api/api.ts';
import type { RepositoryView } from '../../../shared/api/types.ts';

import { ConnectionCard } from './ConnectionCard.tsx';
import { NewConnectionForm } from './NewConnectionForm.tsx';
import { channelsOf, connectionActions, type Done } from './useConnectionActions.ts';

/**
 * The connections of the chat kinds (Telegram, Slack and the like): the form of a new one and a
 * card for each. Webhooks and service registries have tabs of their own.
 */
export function ConnectionsTab({
  api,
  overview,
  registry,
  done,
}: {
  api: Api;
  overview: IntegrationsOverview;
  registry: readonly RepositoryView[];
  done: Done;
}) {
  const { t } = useTranslation();
  const actions = connectionActions(api, done);
  const channels = channelsOf(overview);
  const connections = overview.connections.filter(
    (one) => one.kind !== 'webhook' && one.kind !== 'service-registry',
  );
  return (
    <section className="flex flex-col gap-3" aria-labelledby="connections-title">
      <h2 id="connections-title" className="text-base font-semibold">
        {t('integrations.connections.title')}
      </h2>
      <NewConnectionForm types={overview.types} registry={registry} onCreate={actions.onCreate} />
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.connections.empty')}</p>
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
          />
        ))
      )}
    </section>
  );
}
