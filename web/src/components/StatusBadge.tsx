import { cn } from '../lib/cn.ts';
import { statusInfo, waitText } from '../status.ts';
import type { GroupWait } from '../types.ts';
import { Badge } from '../ui/badge.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';
import { useTranslation } from 'react-i18next';

/** Status as an icon and a label in the active language; the code stays in the accessible name and the tooltip. */
export function StatusBadge({
  status,
  label,
  title,
  wait,
}: {
  status: string;
  label?: string;
  /** Full text shown on hover when the label is cut. */
  title?: string;
  /** Why the group waits; shown on hover. */
  wait?: GroupWait | null;
}) {
  const { t } = useTranslation();
  const info = statusInfo(status, t);
  const Icon = info.icon;
  const text = label ?? info.label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={info.tone} aria-label={`${text} (${status})`} tabIndex={0}>
          <Icon aria-hidden className={cn(info.spin && 'motion-safe:animate-spin')} />
          <span className="min-w-0 truncate" title={title}>
            {text}
          </span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{wait ? `${waitText(wait, t)} (${status})` : status}</TooltipContent>
    </Tooltip>
  );
}
