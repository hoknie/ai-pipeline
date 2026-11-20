import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { RepositoryView } from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';

import { ConnectionCard } from './ConnectionCard.tsx';
import { JournalSection } from './JournalSection.tsx';
import { SubscriptionsSection } from './SubscriptionsSection.tsx';
import { WebhooksSection } from './webhooks/index.ts';
import { useIntegrations } from './useIntegrations.ts';

/**
 * The page «Integrations»: connections with their non-secret parameters, subscriptions to
 * notifications and the journal of sending. A secret is never asked for: the page shows the
 * command of the CLI that sets it.
 */
export default function IntegrationsPage({
  api,
  registry,
}: {
  api: Api;
  registry: readonly RepositoryView[];
}) {
  const { t } = useTranslation();
  const { overview, error, loading, reload, act } = useIntegrations(api);
  const [version, setVersion] = useState(0);
  const done = async <T,>(change: () => Promise<T>) => {
    const ok = await act(change);
    setVersion((value) => value + 1);
    return ok;
  };
  const channels = new Map((overview?.channels ?? []).map((one) => [one.connection, one]));
  // webhooks have a section of their own: their addresses and secrets are not edited as parameters
  const connections = (overview?.connections ?? []).filter((one) => one.kind !== 'webhook');
  const chat = connections.filter((one) =>
    (overview?.types.find((type) => type.kind === one.kind)?.directions ?? []).includes('outbound'),
  );
  return (
    <div className="flex min-w-0 flex-col gap-5 p-4" data-testid="integrations-page">
      {error === null ? null : (
        <Alert variant="destructive" className="flex flex-wrap items-center gap-2">
          <span>{t('integrations.error', { message: error })}</span>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t('integrations.retry')}
          </Button>
        </Alert>
      )}
      {overview === null && loading ? (
        <div role="status" aria-label={t('integrations.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : null}
      {overview === null ? null : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="connections-title">
            <h2 id="connections-title" className="text-base font-semibold">
              {t('integrations.connections.title')}
            </h2>
            {connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('integrations.connections.empty')}{' '}
                <code>aip integration add telegram main --global --param allowed_users=…</code>
              </p>
            ) : (
              connections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  type={overview.types.find((type) => type.kind === connection.kind)}
                  channel={channels.get(connection.id) ?? null}
                  onEdit={(id, change) => done(() => api.integrationEdit(id, change))}
                />
              ))
            )}
          </section>
          <SubscriptionsSection
            api={api}
            overview={overview}
            registry={registry}
            chat={chat}
            done={done}
          />
          <WebhooksSection api={api} registry={registry} version={version} />
          <JournalSection api={api} subscriptions={overview.subscriptions} version={version} />
        </>
      )}
    </div>
  );
}
