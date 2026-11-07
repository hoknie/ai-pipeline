import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../shared/ui/feedback/badge.tsx';

/** A tag of a specialist: neutral; a shared tag carries a globe and a hint. */
export function SpecialistTagChip({
  name,
  shared = false,
  hint,
  children,
}: {
  name: string;
  shared?: boolean;
  /** Tooltip of a shared tag; the one of specialists when omitted. */
  hint?: string;
  /** Extra content after the name, such as a remove button. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      data-shared={shared ? 'true' : undefined}
      title={shared ? (hint ?? t('specialists.tags.sharedHint')) : undefined}
      className="gap-1"
    >
      {shared ? (
        <>
          <Globe aria-hidden className="size-3" />
          <span className="sr-only">{t('specialists.tags.shared')}: </span>
        </>
      ) : null}
      {name}
      {children}
    </Badge>
  );
}
