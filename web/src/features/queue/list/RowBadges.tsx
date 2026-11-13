import { useTranslation } from 'react-i18next';

import { when } from '../../../shared/lib/format.ts';
import { useLocale } from '../../../shared/i18n/index.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { PipelinesView, QueueItemView } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { groupsText } from './itemText.ts';
import { ReadinessBadge, SkippedSteps } from './RowParts.tsx';

/** The state of an item: hold, return of a run, postponed, readiness and whether it is linked. */
export function RowStatus({
  item,
  postponed,
  linked,
}: {
  item: QueueItemView;
  postponed: boolean;
  linked: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {item.hold !== null ? (
        <Badge variant="warn">
          {item.hold === 'paused' ? t('queue.list.paused') : t('queue.list.frozen')}
        </Badge>
      ) : null}
      {item.run !== null ? (
        <a
          className="rounded bg-muted px-1.5 py-0.5 text-xs text-primary underline"
          title={t('queue.returnOf', { run: item.run })}
          href={formatRoute({ view: 'runs', run: item.run, group: null, step: null, tab: null })}
        >
          {item.hold === 'paused' ? t('queue.onPause') : t('queue.returning')}
        </a>
      ) : null}
      {postponed ? (
        <Badge variant="warn" title={t('queue.list.activeHint')}>
          {t('queue.list.postponed')}
        </Badge>
      ) : null}
      {item.filtered ? (
        <Badge variant="mute" title={t('queue.filter.filteredHint')}>
          {t('queue.filter.filtered')}
        </Badge>
      ) : null}
      <ReadinessBadge item={item} />
      {linked ? <span className="sr-only">{t('queue.list.linked')}</span> : null}
    </>
  );
}

/** What the item will do with its result, the skipped steps, the groups and the age. */
export function RowMeta({
  item,
  pipelines,
  now,
}: {
  item: QueueItemView;
  pipelines: PipelinesView | null | undefined;
  now: number;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <>
      {item.autoDeliver === null ? null : (
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {item.autoDeliver ? t('queue.list.autoDelivery') : t('queue.list.manualDelivery')}
        </span>
      )}
      {item.deliveryMode === null || item.deliveryMode === undefined ? null : (
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {t('queue.list.deliveryMode', { mode: t(`deliveryMode.${item.deliveryMode}`) })}
        </span>
      )}
      <SkippedSteps item={item} pipelines={pipelines} />
      {item.title && item.groups ? (
        <span className="text-muted-foreground">{groupsText(item.groups.length, t)}</span>
      ) : null}
      <time
        className="text-xs text-muted-foreground tabular-nums"
        dateTime={new Date(item.createdAt).toISOString()}
        title={t('queue.list.addedAt', {
          when: new Date(item.createdAt).toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        })}
      >
        {when(item.createdAt, now, locale)}
      </time>
    </>
  );
}
