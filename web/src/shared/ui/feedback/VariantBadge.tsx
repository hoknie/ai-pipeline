import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from './badge.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx';

/** The id of the variant that is the pipeline as it is; its badge is never shown. */
export const DEFAULT_VARIANT = 'default';

/**
 * The variant of the pipeline of a run or a queue task, next to the pipeline badge. Nothing for
 * `default`. Not interactive; `focusable={false}` inside buttons and command items.
 */
export function VariantBadge({
  id,
  name,
  focusable = true,
}: {
  id: string;
  name: string;
  focusable?: boolean;
}) {
  const { t } = useTranslation();
  if (id === DEFAULT_VARIANT) return null;
  const label =
    name === id ? t('variantBadge.labelSame', { id }) : t('variantBadge.label', { name, id });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="max-w-32 rounded-md"
          aria-label={label}
          tabIndex={focusable ? 0 : undefined}
        >
          <Layers aria-hidden />
          <span className="min-w-0 truncate">{name}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
