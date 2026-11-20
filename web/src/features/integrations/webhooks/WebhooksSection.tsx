import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { RepositoryView, WebhookView } from '../../../shared/api/types.ts';

import { messageOf } from '../events.ts';
import { POLL_MS } from '../useIntegrations.ts';
import { WebhookForm } from './WebhookForm.tsx';
import { WebhookRow } from './WebhookRow.tsx';

/**
 * The webhooks: made, switched, tested and read here; the signing secret is set with the CLI, whose
 * command the row shows. An address is shown without its query.
 */
export function WebhooksSection({
  api,
  registry,
  version,
}: {
  api: Api;
  registry: readonly RepositoryView[];
  /** Changes when the rest of the page did something. */
  version: number;
}) {
  const { t } = useTranslation();
  const [webhooks, setWebhooks] = useState<WebhookView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState(0);
  const load = useCallback(
    () =>
      api
        .webhooks()
        .then((next) => {
          setWebhooks(next);
          setError(null);
        })
        .catch((failure: unknown) => setError(messageOf(failure))),
    [api],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, version]);
  const done = async <T,>(change: () => Promise<T>): Promise<boolean> => {
    try {
      await change();
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    }
    setOwn((value) => value + 1);
    await load();
    return true;
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="webhooks-title">
      <h2 id="webhooks-title" className="text-base font-semibold">
        {t('integrations.webhooks.title')}
      </h2>
      {error === null ? null : <p className="text-sm text-status-err">{error}</p>}
      {webhooks !== null && webhooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.webhooks.empty')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(webhooks ?? []).map((webhook) => (
          <WebhookRow
            key={webhook.id}
            api={api}
            webhook={webhook}
            registry={registry}
            version={own + version}
            done={done}
          />
        ))}
      </ul>
      <WebhookForm registry={registry} onAdd={(webhook) => done(() => api.webhookAdd(webhook))} />
    </section>
  );
}
