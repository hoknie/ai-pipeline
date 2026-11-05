import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { runStatusLabel } from '../../status.ts';
import type { GroupRow, RunView, SystemStepRow } from '../../types.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { deliveryBadge } from './delivery.ts';

export type StatusPartKey = 'run' | 'entry' | 'merge' | 'delivery';

export interface StatusPart {
  key: StatusPartKey;
  label: string;
  badges: ReactNode[];
}

/** Badge of the open group or step; a running one of a held run is finishing its last step. */
export function entryBadge(entry: GroupRow | SystemStepRow, t: TFunction): ReactNode {
  if (entry.status === 'running' && entry.hold != null) {
    return (
      <StatusBadge
        status="running"
        label={t('status.finishing')}
        tip={t('runs.header.finishingTip', { hold: t(`status.${entry.hold}`) })}
      />
    );
  }
  return <StatusBadge status={entry.status} wait={entry.wait} />;
}

/** Whether the working groups of the run are merged: none, `m` of `n`, or all of them. */
function mergeBadge(run: RunView, t: TFunction): ReactNode | null {
  const total = run.groups.length;
  if (total === 0) return null;
  const merged = run.groups.filter((group) => group.status === 'merged').length;
  if (merged === 0) return <StatusBadge status="not_merged" />;
  if (merged < total) {
    return <StatusBadge status="merged" label={t('status.mergedOf', { merged, total })} />;
  }
  return <StatusBadge status="merged" />;
}

/**
 * Labelled parts of the statuses of a run: run, open group or step, merge and delivery.
 * The merge badge sits inside the group part; it is a part of its own for a step or no entry.
 */
export function statusParts(
  run: RunView,
  entry: GroupRow | SystemStepRow | null,
  t: TFunction,
  onSelect?: (slug: string) => void,
): StatusPart[] {
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
  const parts: StatusPart[] = [
    {
      key: 'run',
      label: t('runs.header.parts.run'),
      badges: [<StatusBadge key="run" status={run.state} label={runStatusLabel(run, t)} />],
    },
  ];
  if (entry) {
    const isStep = 'kind' in entry;
    const badges: ReactNode[] = [<span key="entry">{entryBadge(entry, t)}</span>];
    // The merge of a working group joins its part; a merged group of a fully merged run says it once.
    const joined = isStep ? null : mergeBadge(run, t);
    const allMerged =
      run.groups.length > 0 && run.groups.every((group) => group.status === 'merged');
    if (joined && !(entry.status === 'merged' && allMerged)) {
      badges.push(<span key="merge">{joined}</span>);
    }
    parts.push({
      key: 'entry',
      label: t(isStep ? 'runs.header.parts.step' : 'runs.header.parts.group'),
      badges,
    });
  }
  const merge = entry && !('kind' in entry) ? null : mergeBadge(run, t);
  if (merge) {
    parts.push({
      key: 'merge',
      label: t('runs.header.parts.merge'),
      badges: [<span key="merge">{merge}</span>],
    });
  }
  const deliveryBadges: ReactNode[] = [];
  if (badge) {
    deliveryBadges.push(
      <StatusBadge
        key="delivery"
        status={badge.status}
        title={badge.reason ?? undefined}
        tip={resolverTip}
        onClick={resolver ? () => onSelect?.('_resolve') : undefined}
        label={
          badge.label === 'delivering'
            ? t('runs.header.delivering')
            : badge.label === 'deliveryFailed'
              ? t('runs.header.deliveryFailed', { n: delivery.failed })
              : badge.label === 'deliveredManually'
                ? t('runs.header.deliveredManually')
                : badge.label === 'delivery'
                  ? t('runs.header.delivery', {
                      applied: delivery.applied,
                      merged: delivery.merged,
                    })
                  : undefined
        }
      />,
    );
  }
  if (groupDelivery) deliveryBadges.push(<StatusBadge key="group" status={groupDelivery} />);
  if (badge) {
    parts.push({ key: 'delivery', label: t('runs.header.parts.delivery'), badges: deliveryBadges });
  }
  return parts;
}

/** Statuses of a run with a label each: the run, the open group or step, the merge and the delivery. */
export function RunStatuses({
  run,
  entry,
  onSelect,
  layout = 'rows',
}: {
  run: RunView;
  entry: GroupRow | SystemStepRow | null;
  /** Opens a group or a system step of the run (the resolver). */
  onSelect?: (slug: string) => void;
  /** `rows`: a line per part; `inline`: all parts in one wrapping line. */
  layout?: 'rows' | 'inline';
}) {
  const { t } = useTranslation();
  const parts = statusParts(run, entry, t, onSelect);
  if (layout === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {parts.map((part) => (
          <span key={part.key} className="inline-flex flex-wrap items-center gap-1.5">
            <span data-part={part.key} className="text-xs text-muted-foreground">
              {part.label}:
            </span>
            {part.badges}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      {parts.map((part) => (
        <div key={part.key} className="contents">
          <span data-part={part.key} className="text-xs text-muted-foreground">
            {part.label}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">{part.badges}</span>
        </div>
      ))}
    </div>
  );
}
