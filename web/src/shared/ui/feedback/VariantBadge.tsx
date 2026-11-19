import { Layers, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AuthorView } from '../../api/types.ts';
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

/**
 * The provider a run or a queue task follows in its tiers, next to the pipeline badge. Nothing
 * when none is chosen. Not interactive.
 */
export function ProviderBadge({
  provider,
  name,
}: {
  provider: string | null | undefined;
  /** The human name of the provider; without it (a removed provider, an old snapshot) the slug is shown. */
  name?: string | null | undefined;
}) {
  const { t } = useTranslation();
  if (!provider) return null;
  const named = name?.trim() ? name.trim() : null;
  return (
    <Badge
      variant="outline"
      className="max-w-32 rounded-md"
      aria-label={
        named
          ? t('providerBadge.named', { name: named, id: provider })
          : t('providerBadge.label', { id: provider })
      }
      title={provider}
      data-provider={provider}
    >
      <span className="min-w-0 truncate">{named ?? `@${provider}`}</span>
    </Badge>
  );
}

/**
 * Who created a task or a run: the name, and the email in the tooltip. Without an author nothing
 * is shown, unless `createdBySystem` says the task came from the system itself: then it reads "system".
 * Not interactive.
 */
export function AuthorBadge({
  author,
  createdBySystem = false,
}: {
  author: AuthorView | null | undefined;
  createdBySystem?: boolean | undefined;
}) {
  const { t } = useTranslation();
  if (!author) {
    return createdBySystem ? (
      <Badge variant="outline" className="max-w-32 rounded-md" data-author="system">
        <User aria-hidden />
        <span className="min-w-0 truncate">{t('authorBadge.system')}</span>
      </Badge>
    ) : null;
  }
  const label = t('authorBadge.label', { name: author.name, email: author.email });
  return (
    <Badge
      variant="outline"
      className={`max-w-32 rounded-md ${author.disabled ? 'opacity-60' : ''}`}
      aria-label={label}
      title={author.disabled ? `${author.email} (${t('authorBadge.disabled')})` : author.email}
      data-author={author.id}
    >
      <User aria-hidden />
      <span className="min-w-0 truncate">{author.name}</span>
    </Badge>
  );
}
