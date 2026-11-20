import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api, IntegrationsOverview } from '../../shared/api/api.ts';
import type { IntegrationTypeView, RepositoryView } from '../../shared/api/types.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import { INTEGRATION_TABS, type IntegrationTab } from '../../shared/lib/nav/settingsGroups.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';

import { CatalogTab } from './catalog/CatalogTab.tsx';
import { catalogKinds } from './catalog/kinds.ts';
import { KindPage } from './catalog/KindPage.tsx';
import { JournalSection } from './JournalSection.tsx';
import { SubscriptionsSection } from './SubscriptionsSection.tsx';
import type { Done } from './connections/useConnectionActions.ts';
import { useIntegrations } from './useIntegrations.ts';
import { WebhooksSection } from './webhooks/index.ts';

const hrefOf = (tab: IntegrationTab) =>
  formatRoute({ view: 'settings', run: 'integrations', group: 'global', step: tab, tab: null });

const CATALOG_HREF = hrefOf('catalog');

type BodyProps = {
  api: Api;
  overview: IntegrationsOverview;
  registry: readonly RepositoryView[];
  tab: IntegrationTab;
  /** The kind whose page is open in the catalog; undefined for the catalog itself. */
  type: IntegrationTypeView | undefined;
  done: Done;
  version: number;
  leave: (href: string) => (event: MouseEvent) => Promise<void>;
};

/** The content of the open tab. */
function Body({ api, overview, registry, tab, type, done, version, leave }: BodyProps) {
  if (tab === 'catalog') {
    return type === undefined ? (
      <CatalogTab overview={overview} leave={leave} />
    ) : (
      <KindPage
        api={api}
        type={type}
        overview={overview}
        registry={registry}
        done={done}
        version={version}
        leave={leave}
      />
    );
  }
  if (tab === 'notifications') {
    const chat = overview.connections.filter(
      (one) =>
        one.kind !== 'webhook' &&
        (overview.types.find((type) => type.kind === one.kind)?.directions ?? []).includes(
          'outbound',
        ),
    );
    return (
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
    );
  }
  return <WebhooksSection api={api} registry={registry} version={version} />;
}

/**
 * The group «Integrations» of the shared settings: the catalog of the kinds of connections (a page
 * for each kind), notifications and webhooks, one tab each (the tabs and the pages are addresses). A secret is never asked for: the cards show
 * the command of the CLI that sets it.
 */
export default function IntegrationsGroup({
  api,
  registry,
  tab,
  kind,
  leave,
}: {
  api: Api;
  registry: readonly RepositoryView[];
  tab: IntegrationTab;
  /** The kind whose page of the catalog is open; null for the catalog itself. */
  kind: string | null;
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
  const types = overview === null ? null : catalogKinds(overview.types);
  const type = types?.find((one) => one.kind === kind);
  // a kind the catalog does not have: the address is replaced by the one of the catalog
  const unknown = tab === 'catalog' && kind !== null && types !== null && type === undefined;
  useEffect(() => {
    if (unknown) window.location.replace(CATALOG_HREF);
  }, [unknown]);
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
      {overview === null ? null : (
        <Body
          api={api}
          overview={overview}
          registry={registry}
          tab={tab}
          type={type}
          done={done}
          version={version}
          leave={leave}
        />
      )}
    </div>
  );
}
