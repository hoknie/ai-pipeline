import { cn } from '../lib/cn.ts';
import { statusInfo } from '../status.ts';
import { Badge } from '../ui/badge.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';
import { useTranslation } from 'react-i18next';

/** Status as an icon and a label in the active language; the code stays in the accessible name and the tooltip. */
export function StatusBadge({
  status,
  label,
  title,
}: {
  status: string;
  label?: string;
  /** Full text shown on hover when the label is cut. */
  title?: string;
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
      <TooltipContent>{status}</TooltipContent>
    </Tooltip>
  );
}
