import { cn } from '../../../shared/lib/browser/cn.ts';
import { connectionLabel } from '../../../shared/lib/status.ts';
import type { Connection } from '../../../shared/api/stream.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';
import { useTranslation } from 'react-i18next';

import { navRowClass } from '../nav/navRow.ts';

const DOT: Record<Connection, string> = {
  live: 'bg-status-ok',
  reconnecting: 'bg-status-warn motion-safe:animate-pulse',
  polling: 'bg-status-run',
};

/** Dot and label of the link with the daemon; the code is in the tooltip. */
export function ConnectionIndicator({
  connection,
  compact = false,
}: {
  connection: Connection;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const label = connectionLabel(connection, t);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          tabIndex={0}
          aria-label={t('connection.label', { state: label })}
          data-nav-row
          className={cn(
            navRowClass(),
            'text-xs text-muted-foreground',
            compact && 'w-8 justify-center px-0',
          )}
        >
          <span aria-hidden className="flex size-4 items-center justify-center">
            <span className={cn('size-2 shrink-0 rounded-full', DOT[connection])} />
          </span>
          {compact ? null : <span>{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side={compact ? 'bottom' : 'top'}>
        {compact ? `${label} (${connection})` : connection}
      </TooltipContent>
    </Tooltip>
  );
}
