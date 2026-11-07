import type { ReactNode } from 'react';

import { taskNumber } from '../../../shared/lib/format.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { QueueRunView } from '../../../shared/api/types.ts';
import { Card } from '../../../shared/ui/layout/card.tsx';
import { ActiveGroups, CardBadges, Problem, Progress, SystemStages, Usage } from './CardParts.tsx';

/** A run of the queue: title, state, progress, the groups at work and an optional action. */
export function RunCard({
  run,
  now,
  linked,
  action = null,
}: {
  run: QueueRunView;
  now: number;
  linked: boolean;
  action?: ReactNode;
}) {
  return (
    <Card
      role="group"
      aria-label={run.title}
      data-highlighted={linked ? '' : undefined}
      className={cn('flex min-w-0 flex-col gap-2 p-3 text-sm', linked && 'ring-2 ring-primary')}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {taskNumber(run.number)}
        </span>
        <a
          className="min-w-0 truncate font-medium text-primary underline"
          title={run.title}
          href={formatRoute({ view: 'runs', run: run.id, group: null, step: null, tab: null })}
        >
          {run.title}
        </a>
      </div>
      <CardBadges run={run} />
      <SystemStages run={run} />
      <Usage run={run} now={now} />
      <Progress run={run} />
      <ActiveGroups run={run} />
      <Problem run={run} />
      {action ? <div>{action}</div> : null}
    </Card>
  );
}
