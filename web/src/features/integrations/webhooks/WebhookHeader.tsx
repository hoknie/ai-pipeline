import { useTranslation } from 'react-i18next';

import type { WebhookView } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { secretCommand } from '../events.ts';

const SLOT = 'signing_secret';

/** The name, the address without its query, the scope, the state and what is missing. */
export function WebhookHeader({
  webhook,
  project,
}: {
  webhook: WebhookView;
  /** The name of the project of the scope; null: every project. */
  project: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <strong>{webhook.name}</strong>
        <code className="text-sm">{webhook.url}</code>
        <span className="text-xs text-muted-foreground">
          {project === null
            ? t('integrations.scope.global')
            : t('integrations.scope.project', { project })}
        </span>
        <Badge variant={webhook.enabled ? 'ok' : 'mute'}>
          {t(webhook.enabled ? 'integrations.enabled' : 'integrations.disabled')}
        </Badge>
        {webhook.disabledReason === null ? null : (
          <span className="text-sm text-status-err">
            {t('integrations.webhooks.reason', { reason: webhook.disabledReason })}
          </span>
        )}
      </div>
      {webhook.secret ? null : (
        <p className="text-sm text-muted-foreground">
          {t('integrations.secret.hint')} <code>{secretCommand(webhook.id, SLOT)}</code>
        </p>
      )}
    </>
  );
}
