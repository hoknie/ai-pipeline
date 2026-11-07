import { cn } from '../../lib/browser/cn.ts';
import { statusInfo, waitText } from '../../lib/status.ts';
import type { GroupWait } from '../../api/types.ts';
import { Badge } from './badge.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

/** Status as an icon and a label in the active language; the code stays in the accessible name and the tooltip. */
export function StatusBadge({
  status,
  label,
  title,
  wait,
  tip,
  onClick,
}: {
  status: string;
  label?: string;
  /** Full text shown on hover when the label is cut. */
  title?: string;
  /** Why the group waits; shown on hover. */
  wait?: GroupWait | null;
  /** Extra tooltip text shown after the status code. */
  tip?: string;
  /** Makes the badge itself the one focusable button (Enter and Space activate it). */
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const info = statusInfo(status, t);
  const Icon = info.icon;
  const text = label ?? info.label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={info.tone}
          aria-label={`${text} (${status})`}
          tabIndex={0}
          {...(onClick
            ? {
                role: 'button',
                className: 'cursor-pointer',
                onClick,
                onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick();
                  }
                },
              }
            : {})}
        >
          <Icon aria-hidden className={cn(info.spin && 'motion-safe:animate-spin')} />
          <span className="min-w-0 truncate" title={title}>
            {text}
          </span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {wait ? `${waitText(wait, t)} (${status})` : tip ? `${status} · ${tip}` : status}
      </TooltipContent>
    </Tooltip>
  );
}
