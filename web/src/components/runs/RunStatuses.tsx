import { useTranslation } from 'react-i18next';

import { runStatusLabel } from '../../status.ts';
import type { GroupRow, RunView, SystemStepRow } from '../../types.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { deliveryBadge } from './delivery.ts';

/** Statuses of a run: its state, its delivery and the status of the open group or step. */
export function RunStatuses({
  run,
  entry,
  onSelect,
}: {
  run: RunView;
  entry: GroupRow | SystemStepRow | null;
  /** Opens a group or a system step of the run (the resolver). */
  onSelect?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const { delivery } = run;
  const badge = deliveryBadge(run);
  const resolver = run.resolver;
  const resolverTip = resolver
    ? [
        t('runs.header.resolver'),
        t(`status.${resolver.status}`, { defaultValue: resolver.status }),
        t('runs.header.round', { round: resolver.round, rounds: resolver.rounds }),
        resolver.conflicts.length > 0
          ? t('runs.header.conflicts', { list: resolver.conflicts.join(', ') })
          : null,
        badge?.reason,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const groupDelivery =
    entry && !('kind' in entry) && entry.status === 'merged' && delivery.merged >= 2
      ? !delivery.inProgress
        ? entry.delivery
        : null
      : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={run.state} label={runStatusLabel(run, t)} />
      {badge ? (
        <StatusBadge
          status={badge.status}
          title={badge.reason ?? undefined}
          tip={resolverTip}
          onClick={resolver ? () => onSelect?.('_resolve') : undefined}
          label={
            badge.label === 'delivering'
              ? t('runs.header.delivering')
              : badge.label === 'deliveryFailed'
                ? t('runs.header.deliveryFailed', { n: delivery.failed })
                : badge.label === 'delivery'
                  ? t('runs.header.delivery', {
                      applied: delivery.applied,
                      merged: delivery.merged,
                    })
                  : undefined
          }
        />
      ) : null}
      {entry ? <StatusBadge status={entry.status} wait={entry.wait} /> : null}
      {groupDelivery ? <StatusBadge status={groupDelivery} /> : null}
    </div>
  );
}
