import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { clock } from '../../../shared/lib/format.ts';
import { useNow } from './useNow.ts';

/** The remaining time of a limit: `40 min`, `2 h 5 min`. */
function remaining(ms: number, t: TFunction): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return t('providers.limit.minutes', { count: minutes });
  return t('providers.limit.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** «Limit»: when the hold of the usage limit lifts and how long is left; `—` without a hold. */
export function LimitCell({ until }: { until: number | null }) {
  const { t } = useTranslation();
  const now = useNow(until);
  if (until === null || until <= now) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-status-warn">
      {t('providers.limit.until', { time: clock(until) })} · {remaining(until - now, t)}
    </span>
  );
}
