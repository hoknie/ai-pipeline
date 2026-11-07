import { useTranslation } from 'react-i18next';

import { progressPercent } from '../../../shared/lib/format.ts';

/** A thin progress line with the percentage; the percentage has a fixed width so the line never shifts. */
export function RunProgress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const percent = progressPercent({ done, total });
  return (
    <span
      role="progressbar"
      aria-label={t('runs.list.progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="flex items-center gap-2"
    >
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          data-fill
          className="block h-full rounded-full"
          style={{
            width: `${percent}%`,
            backgroundColor: `color-mix(in oklch, var(--color-status-ok) ${percent}%, var(--color-status-warn))`,
          }}
        />
      </span>
      <span className="w-[4ch] shrink-0 text-right text-xs tabular-nums">{percent}%</span>
    </span>
  );
}
