import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectionView, IntegrationTypeView } from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { kindTitle } from '../kindLabels.ts';
import { kindIcon } from './kindIcon.ts';

/** The address of the page of a kind in the catalog. */
export const kindHref = (kind: string) =>
  formatRoute({
    view: 'settings',
    run: 'integrations',
    group: 'global',
    step: 'catalog',
    tab: kind,
  });

/** A card of the catalog: the kind, how many connections it has and the link to its page. */
export function KindCard({
  type,
  connections,
  leave,
}: {
  type: IntegrationTypeView;
  connections: readonly ConnectionView[];
  leave: (href: string) => (event: MouseEvent) => Promise<void>;
}) {
  const { t } = useTranslation();
  const Icon = kindIcon(type.kind);
  const href = kindHref(type.kind);
  const title = kindTitle(t, type.kind, type.title);
  const description = t(`integrations.kinds.${type.kind}.description`, { defaultValue: '' });
  return (
    <a
      href={href}
      onClick={(event) => void leave(href)(event)}
      data-testid={`kind-card-${type.kind}`}
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 hover:border-primary"
    >
      <span className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-5" aria-hidden="true" />
        {title}
      </span>
      {description === '' ? null : (
        <span className="text-sm text-muted-foreground">{description}</span>
      )}
      <span className="text-xs text-muted-foreground">
        {connections.length === 0
          ? t('integrations.catalog.none')
          : t('integrations.catalog.count', {
              count: connections.length,
              enabled: connections.filter((one) => one.enabled).length,
            })}
      </span>
      <span className="text-sm font-medium text-primary">
        {connections.length === 0
          ? t('integrations.catalog.connect')
          : t('integrations.catalog.open')}
      </span>
    </a>
  );
}
