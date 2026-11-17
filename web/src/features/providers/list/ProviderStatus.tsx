import { CheckCircle2, CircleSlash, TriangleAlert } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { AccessState, ProviderStatus as Status } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { reasonText } from './reasons.ts';

const LOOK = {
  available: { variant: 'ok', Icon: CheckCircle2 },
  unavailable: { variant: 'warn', Icon: TriangleAlert },
  disabled: { variant: 'mute', Icon: CircleSlash },
} as const;

/** The status text: «Available», «Unavailable», «Disabled». */
export function useStatusText(): (status: Status) => string {
  const { t } = useTranslation();
  return (status) => t(`providers.status.${status}`);
}

/** The icon of a status, for a combobox and a list. */
export function StatusIcon({ status }: { status: Status }) {
  const { Icon } = LOOK[status];
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

/** The accesses with their availability and reasons: the hint of the status. */
export function accessSummary(access: readonly AccessState[], t: TFunction) {
  return access
    .map((item) => {
      const name = item.kind === 'api' ? 'API' : (item.runtime ?? '—');
      const state = item.available
        ? t('providers.status.available')
        : `${t('providers.status.unavailable')}: ${item.reasons.map((reason) => reasonText(reason, t)).join(', ')}`;
      return `${item.index + 1}. ${name} — ${state}`;
    })
    .join('\n');
}

/** A status with an icon and text; an unavailable provider lists the reasons next to it. */
export function ProviderStatusBadge({
  status,
  reasons = [],
}: {
  status: Status;
  reasons?: readonly string[];
}) {
  const { t } = useTranslation();
  const text = useStatusText();
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <Badge variant={LOOK[status].variant} className="w-fit">
        <StatusIcon status={status} />
        {text(status)}
      </Badge>
      {status === 'unavailable' && reasons.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          {reasons.map((reason) => reasonText(reason, t)).join('; ')}
        </span>
      ) : null}
    </span>
  );
}
