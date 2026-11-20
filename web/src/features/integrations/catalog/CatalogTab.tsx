import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationsOverview } from '../../../shared/api/api.ts';
import { catalogKinds } from './kinds.ts';
import { KindCard } from './KindCard.tsx';

/** The catalog of the kinds of connections: a card for each, a link to the page of the kind. */
export function CatalogTab({
  overview,
  leave,
}: {
  overview: IntegrationsOverview;
  leave: (href: string) => (event: MouseEvent) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="catalog-title">
      <h2 id="catalog-title" className="text-base font-semibold">
        {t('integrations.catalog.title')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {catalogKinds(overview.types).map((type) => (
          <KindCard
            key={type.kind}
            type={type}
            connections={overview.connections.filter((one) => one.kind === type.kind)}
            leave={leave}
          />
        ))}
      </div>
    </section>
  );
}
