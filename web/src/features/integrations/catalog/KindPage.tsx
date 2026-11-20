import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api, IntegrationsOverview } from '../../../shared/api/api.ts';
import type { IntegrationTypeView, RepositoryView } from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { ConnectionCard } from '../connections/ConnectionCard.tsx';
import { NewConnectionForm } from '../connections/NewConnectionForm.tsx';
import { channelsOf, connectionActions, type Done } from '../connections/useConnectionActions.ts';
import { kindTitle } from '../kindLabels.ts';
import { RegistryLinks } from '../registry/RegistryLinks.tsx';
import { REGISTRY_KIND } from './kinds.ts';

/** The steps that set up a kind; nothing for a kind the dictionary has no steps for. */
function SetupSteps({ kind }: { kind: string }) {
  const { t } = useTranslation();
  const setup = (t as unknown as (key: string, options: object) => unknown)(
    `integrations.kinds.${kind}.setup`,
    { returnObjects: true, defaultValue: {} },
  );
  const steps = typeof setup === 'object' && setup !== null ? Object.values(setup).map(String) : [];
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{t('integrations.catalog.setupTitle')}</h3>
      <ol className="list-decimal pl-5 text-sm text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

const catalogHref = formatRoute({
  view: 'settings',
  run: 'integrations',
  group: 'global',
  step: 'catalog',
  tab: null,
});

/**
 * The page of one kind: the way to set it up, the form of a new connection and a card for each
 * connection of the kind. The registry also has the check and the links of the projects.
 */
export function KindPage({
  api,
  type,
  overview,
  registry,
  done,
  version,
  leave,
}: {
  api: Api;
  type: IntegrationTypeView;
  overview: IntegrationsOverview;
  registry: readonly RepositoryView[];
  done: Done;
  version: number;
  leave: (href: string) => (event: MouseEvent) => Promise<void>;
}) {
  const { t } = useTranslation();
  const actions = connectionActions(api, done);
  const channels = channelsOf(overview);
  const connections = overview.connections.filter((one) => one.kind === type.kind);
  const checked = type.kind === REGISTRY_KIND;
  const description = t(`integrations.kinds.${type.kind}.description`, { defaultValue: '' });
  return (
    <div className="flex flex-col gap-4">
      <a
        href={catalogHref}
        onClick={(event) => void leave(catalogHref)(event)}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t('integrations.catalog.back')}
      </a>
      <section className="flex flex-col gap-3" aria-labelledby="kind-title">
        <h2 id="kind-title" className="text-base font-semibold">
          {kindTitle(t, type.kind, type.title)}
        </h2>
        {description === '' ? null : <p className="text-sm text-muted-foreground">{description}</p>}
        <SetupSteps kind={type.kind} />
        <NewConnectionForm
          key={type.kind}
          type={type}
          registry={registry}
          onCreate={actions.onCreate}
        />
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('integrations.catalog.empty')}</p>
        ) : (
          connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              type={type}
              channel={channels.get(connection.id) ?? null}
              onEdit={actions.onEdit}
              onEnabled={actions.onEnabled}
              onRemove={actions.onRemove}
              onCheck={checked ? actions.onCheck : undefined}
              loadSenders={api.integrationSenders}
            />
          ))
        )}
      </section>
      {checked && connections.length > 0 ? (
        <RegistryLinks api={api} registry={registry} version={version} />
      ) : null}
    </div>
  );
}
