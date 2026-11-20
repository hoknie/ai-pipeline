import { useTranslation } from 'react-i18next';

import type { Api, IntegrationsOverview } from '../../shared/api/api.ts';
import type { ConnectionView, RepositoryView } from '../../shared/api/types.ts';

import { SubscriptionForm } from './SubscriptionForm.tsx';
import { SubscriptionRow } from './SubscriptionRow.tsx';

/** The subscriptions with their switches and the form of a new one; `chat` are the connections that can send. */
export function SubscriptionsSection({
  api,
  overview,
  registry,
  chat,
  done,
}: {
  api: Api;
  overview: IntegrationsOverview;
  registry: readonly RepositoryView[];
  chat: readonly ConnectionView[];
  /** Runs a change and loads again; tells whether it went through. */
  done: <T>(change: () => Promise<T>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="subscriptions-title">
      <h2 id="subscriptions-title" className="text-base font-semibold">
        {t('integrations.subscriptions.title')}
      </h2>
      {overview.subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.subscriptions.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.subscriptions.map((subscription) => (
            <SubscriptionRow
              key={subscription.id}
              subscription={subscription}
              onEvents={(id, events) => void done(() => api.subscriptionEvents(id, events))}
              onEnabled={(id, enabled) => void done(() => api.subscriptionEnabled(id, enabled))}
              onTest={(id) => void done(() => api.subscriptionTest(id))}
              onRemove={(id) => void done(() => api.subscriptionRemove(id))}
            />
          ))}
        </ul>
      )}
      {chat.length === 0 ? null : (
        <SubscriptionForm
          connections={chat}
          registry={registry}
          onAdd={(subscription) => done(() => api.subscriptionAdd(subscription))}
        />
      )}
    </section>
  );
}
