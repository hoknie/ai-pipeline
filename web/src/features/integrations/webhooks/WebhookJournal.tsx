import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { WebhookDeliveryView } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';

import { messageOf } from '../events.ts';

const stateVariant = { sent: 'ok', failed: 'err', pending: 'warn', closed: 'mute' } as const;
const when = (ms: number): string => new Date(ms).toLocaleString();

/** The deliveries of one webhook with every attempt: the time, the answer and how long it took. */
export function WebhookJournal({
  api,
  id,
  version,
  onChanged,
}: {
  api: Api;
  id: string;
  /** Changes when the page did something: the journal is read again. */
  version: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<WebhookDeliveryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .webhookLog(id)
      .then((next) => {
        setRows(next);
        setError(null);
      })
      .catch((failure: unknown) => setError(messageOf(failure)));
  }, [api, id]);
  useEffect(load, [load, version]);
  const again = (delivery: number) => {
    api
      .webhookRedeliver(delivery)
      .then(() => {
        onChanged();
        load();
      })
      .catch((failure: unknown) => setError(messageOf(failure)));
  };
  return (
    <div className="flex flex-col gap-2" data-testid={`webhook-journal-${id}`}>
      {error === null ? null : <p className="text-sm text-status-err">{error}</p>}
      {rows !== null && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.journal.empty')}</p>
      ) : null}
      {(rows ?? []).map((row) => (
        <div
          key={row.id}
          className="rounded-md border p-2 text-sm"
          data-testid={`delivery-${row.id}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="whitespace-nowrap">{when(row.createdAt)}</span>
            <code>{row.type}</code>
            <span>
              {row.run === '-' ? '' : `${row.run}${row.group === null ? '' : `/${row.group}`}`}
            </span>
            <code className="text-xs text-muted-foreground">{row.webhookId}</code>
            <Badge variant={stateVariant[row.state]}>
              {t(`integrations.journal.states.${row.state}`)}
            </Badge>
            {(row.state === 'sent' || row.state === 'failed') && row.type !== 'webhook.test' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => again(row.id)}>
                {t('integrations.webhooks.redeliver')}
              </Button>
            ) : null}
          </div>
          <ol className="mt-1 flex flex-col gap-0.5 text-xs">
            {row.attempts.map((attempt) => (
              <li key={attempt.n} className="flex flex-wrap gap-2">
                <span>#{attempt.n}</span>
                <span>{when(attempt.at)}</span>
                <span>{attempt.statusCode ?? attempt.error ?? ''}</span>
                <span>{attempt.durationMs} ms</span>
                {attempt.excerpt ? (
                  <code className="text-muted-foreground">{attempt.excerpt.slice(0, 120)}</code>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
