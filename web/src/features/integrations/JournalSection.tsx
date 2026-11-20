import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { DeliveryView, SubscriptionView } from '../../shared/api/types.ts';

import { DELIVERY_STATES, messageOf } from './events.ts';
import { JournalTable } from './JournalTable.tsx';
import { SelectField } from './SelectField.tsx';
import { POLL_MS } from './useIntegrations.ts';

/** The journal of sending with a filter by subscription and by state. */
export function JournalSection({
  api,
  subscriptions,
  version,
}: {
  api: Api;
  subscriptions: readonly SubscriptionView[];
  /** Changes when something was done on the page, so the journal is read again at once. */
  version: number;
}) {
  const { t } = useTranslation();
  const [subscription, setSubscription] = useState('');
  const [state, setState] = useState('');
  const [rows, setRows] = useState<DeliveryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .deliveries({
        limit: 50,
        ...(subscription === '' ? {} : { subscription }),
        ...(state === '' ? {} : { state }),
      })
      .then((next) => {
        setRows(next);
        setError(null);
      })
      .catch((failure: unknown) => setError(messageOf(failure)));
  }, [api, subscription, state]);
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, version]);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="journal-title">
      <h2 id="journal-title" className="text-base font-semibold">
        {t('integrations.journal.title')}
      </h2>
      <div className="flex flex-wrap gap-3">
        <SelectField
          id="journal-subscription"
          label={t('integrations.journal.subscription')}
          value={subscription}
          onChange={setSubscription}
        >
          <option value="">{t('integrations.journal.any')}</option>
          {subscriptions.map((one) => (
            <option key={one.id} value={one.id}>
              {one.connectionName} · {one.project ?? t('integrations.subscriptions.allProjects')}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="journal-state"
          label={t('integrations.journal.state')}
          value={state}
          onChange={setState}
        >
          <option value="">{t('integrations.journal.any')}</option>
          {DELIVERY_STATES.map((one) => (
            <option key={one} value={one}>
              {t(`integrations.journal.states.${one}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {error === null ? null : <p className="text-sm text-status-err">{error}</p>}
      {rows !== null && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.journal.empty')}</p>
      ) : (
        <JournalTable rows={rows ?? []} />
      )}
    </section>
  );
}
