import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/badge.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

/**
 * The workflow of a run or a queue task: a neutral outlined rectangular badge with a monospace id,
 * unlike the colored rounded status badges and tags. Not interactive; `focusable={false}` inside
 * buttons and command items, where the tooltip is only shown on hover.
 */
export function WorkflowBadge({ id, focusable = true }: { id: string; focusable?: boolean }) {
  const { t } = useTranslation();
  const label = t('workflowBadge.label', { id });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="max-w-40 rounded-md font-mono"
          aria-label={label}
          tabIndex={focusable ? 0 : undefined}
        >
          <GitBranch aria-hidden />
          <span className="min-w-0 truncate">{id}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
