import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { RepositoryView } from '../../shared/api/types.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import { INTEGRATION_TABS, type IntegrationTab } from '../../shared/lib/nav/settingsGroups.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';

import { ConnectionsTab } from './connections/ConnectionsTab.tsx';
import { JournalSection } from './JournalSection.tsx';
import { RegistryTab } from './registry/RegistryTab.tsx';
import { SubscriptionsSection } from './SubscriptionsSection.tsx';
import { useIntegrations } from './useIntegrations.ts';
import { WebhooksSection } from './webhooks/index.ts';

const hrefOf = (tab: IntegrationTab) =>
  formatRoute({ view: 'settings', run: 'integrations', group: 'global', step: tab, tab: null });

/**
 * The group «Integrations» of the shared settings: connections, service registries, notifications
 * and webhooks, one tab each (the tabs are addresses). A secret is never asked for: the cards show
 * the command of the CLI that sets it.
 */
export default function IntegrationsGroup({
  api,
  registry,
  tab,
  leave,
}: {
  api: Api;
  registry: readonly RepositoryView[];
  tab: IntegrationTab;
  /** A link that leaves the page of the settings: with unsaved changes it asks first. */
  leave: (href: string) => (event: MouseEvent) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { overview, error, loading, reload, act } = useIntegrations(api);
  const [version, setVersion] = useState(0);
  const done = async <T,>(change: () => Promise<T>) => {
    const ok = await act(change);
    setVersion((value) => value + 1);
    return ok;
  };
  const chat = (overview?.connections ?? []).filter(
    (one) =>
      one.kind !== 'webhook' &&
      (overview?.types.find((type) => type.kind === one.kind)?.directions ?? []).includes(
        'outbound',
      ),
  );
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="integrations-page">
      <LinkTabs
        label={t('settingsPage.integrationTabs.label')}
        tabs={INTEGRATION_TABS.map((key) => ({
          key,
          label: t(`settingsPage.integrationTabs.${key}`),
          href: hrefOf(key),
          selected: key === tab,
          onClick: (event) => void leave(hrefOf(key))(event),
        }))}
      />
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
      {overview === null ? null : tab === 'connections' ? (
        <ConnectionsTab api={api} overview={overview} registry={registry} done={done} />
      ) : tab === 'registry' ? (
        <RegistryTab
          api={api}
          overview={overview}
          registry={registry}
          done={done}
          version={version}
        />
      ) : tab === 'notifications' ? (
        <>
          <SubscriptionsSection
            api={api}
            overview={overview}
            registry={registry}
            chat={chat}
            done={done}
          />
          <JournalSection api={api} subscriptions={overview.subscriptions} version={version} />
        </>
      ) : (
        <WebhooksSection api={api} registry={registry} version={version} />
      )}
    </div>
  );
}
