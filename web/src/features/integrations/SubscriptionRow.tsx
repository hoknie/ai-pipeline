import { useTranslation } from 'react-i18next';

import type { SubscriptionView } from '../../shared/api/types.ts';
import { Badge } from '../../shared/ui/feedback/badge.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';

import { EventChecks } from './EventChecks.tsx';

/** A subscription with its events, its switch, the test message and removal. */
export function SubscriptionRow({
  subscription,
  onEvents,
  onEnabled,
  onTest,
  onRemove,
}: {
  subscription: SubscriptionView;
  onEvents: (id: string, events: string[]) => void;
  onEnabled: (id: string, enabled: boolean) => void;
  onTest: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
      data-testid={`subscription-${subscription.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{subscription.connectionName}</span>
        <Badge variant="outline">
          {subscription.project ?? t('integrations.subscriptions.allProjects')}
        </Badge>
        <Badge variant={subscription.enabled ? 'ok' : 'mute'}>
          {subscription.enabled ? t('integrations.enabled') : t('integrations.disabled')}
        </Badge>
        <code className="ml-auto text-xs text-muted-foreground">{subscription.id}</code>
      </div>
      <EventChecks
        idPrefix={`sub-${subscription.id}`}
        value={subscription.events}
        onChange={(events) => events.length > 0 && onEvents(subscription.id, events)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onEnabled(subscription.id, !subscription.enabled)}
        >
          {subscription.enabled
            ? t('integrations.subscriptions.disable')
            : t('integrations.subscriptions.enable')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTest(subscription.id)}>
          {t('integrations.subscriptions.test')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onRemove(subscription.id)}>
          {t('integrations.subscriptions.remove')}
        </Button>
      </div>
    </li>
  );
}
