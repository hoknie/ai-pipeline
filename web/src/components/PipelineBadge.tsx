import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/badge.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

/**
 * The pipeline of a run or a queue task: a neutral outlined rectangular badge with its name,
 * unlike the colored rounded status badges and tags. Not interactive; `focusable={false}` inside
 * buttons and command items, where the tooltip is only shown on hover.
 */
export function PipelineBadge({
  id,
  name,
  focusable = true,
}: {
  id: string;
  name: string;
  focusable?: boolean;
}) {
  const { t } = useTranslation();
  const label =
    name === id ? t('pipelineBadge.labelSame', { id }) : t('pipelineBadge.label', { name, id });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="max-w-40 rounded-md"
          aria-label={label}
          tabIndex={focusable ? 0 : undefined}
        >
          <GitBranch aria-hidden />
          <span className="min-w-0 truncate">{name}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
