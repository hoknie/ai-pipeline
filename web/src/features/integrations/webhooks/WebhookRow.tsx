import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { RepositoryView, WebhookView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';

import { EventChecks } from '../EventChecks.tsx';
import { WebhookAddress } from './WebhookAddress.tsx';
import { WebhookHeader } from './WebhookHeader.tsx';
import { WebhookJournal } from './WebhookJournal.tsx';

/** One webhook: its state, the switches, a new address and the events, the journal on demand. */
export function WebhookRow({
  api,
  webhook,
  registry,
  version,
  done,
}: {
  api: Api;
  webhook: WebhookView;
  registry: readonly RepositoryView[];
  version: number;
  done: <T>(change: () => Promise<T>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const project = registry.find((one) => one.path === webhook.project)?.name ?? webhook.project;
  const test = async () => {
    setResult(null);
    await done(async () => {
      const outcome = await api.webhookTest(webhook.id);
      setResult(
        outcome.ok
          ? t('integrations.webhooks.testOk', { status: outcome.statusCode ?? '' })
          : t('integrations.webhooks.testFailed', {
              error: outcome.statusCode ?? outcome.error ?? '',
            }),
      );
    });
  };
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
      data-testid={`webhook-${webhook.id}`}
    >
      <WebhookHeader webhook={webhook} project={project} />
      <EventChecks
        idPrefix={`webhook-${webhook.id}`}
        value={webhook.events}
        onChange={(events) => void done(() => api.webhookEdit(webhook.id, { events }))}
      />
      <WebhookAddress onSave={(url) => done(() => api.webhookEdit(webhook.id, { url }))} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void done(() => api.webhookEnabled(webhook.id, !webhook.enabled))}
        >
          {t(
            webhook.enabled
              ? 'integrations.subscriptions.disable'
              : 'integrations.subscriptions.enable',
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void test()}>
          {t('integrations.subscriptions.test')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {t('integrations.webhooks.journal')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void done(() => api.webhookRemove(webhook.id))}
        >
          {t('integrations.subscriptions.remove')}
        </Button>
        {result === null ? null : <span className="text-sm">{result}</span>}
      </div>
      {open ? (
        <WebhookJournal api={api} id={webhook.id} version={version} onChanged={() => undefined} />
      ) : null}
    </li>
  );
}
