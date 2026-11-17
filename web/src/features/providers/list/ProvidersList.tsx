import { useTranslation } from 'react-i18next';

import type { ProviderView } from '../../../shared/api/types.ts';
import type { ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { LimitCell } from './LimitCell.tsx';
import { ProviderStatusBadge, accessSummary } from './ProviderStatus.tsx';

/** A provider of the list: the registry entry and where it comes from. */
export interface ProviderRow {
  key: string;
  provider: ProviderView;
  /** The project file overrides a shared one. */
  overrides: boolean;
  /** The project of a project provider in the mode «All projects»; null otherwise. */
  project: ProjectRef | null;
}

export const reasonsOf = (provider: ProviderView): string[] => [
  ...new Set(provider.access.flatMap((access) => access.reasons)),
];

function useLevelText() {
  const { t } = useTranslation();
  return (row: ProviderRow) => {
    if (row.provider.level === 'global') return t('providers.level.global');
    return row.overrides ? t('providers.level.overrides') : t('providers.level.project');
  };
}

function RowBody({ row, narrow }: { row: ProviderRow; narrow: boolean }) {
  const { t } = useTranslation();
  const levelText = useLevelText();
  const { provider } = row;
  const active = provider.active === null ? undefined : provider.access[provider.active];
  return (
    <span
      className={cn(
        'grid w-full items-center gap-x-3 gap-y-1 text-left',
        narrow
          ? 'grid-cols-1'
          : 'grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_8rem_minmax(0,1.6fr)_minmax(0,1.2fr)]',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium" title={provider.slug}>
          {provider.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{provider.slug}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {row.project ? <ProjectDot color={row.project.color} /> : null}
        {row.project ? <span>{row.project.label}</span> : null}
        <span>{levelText(row)}</span>
      </span>
      <span
        className="truncate text-sm"
        title={accessSummary(provider.access, t)}
        aria-label={t('providers.list.accessLabel')}
      >
        {active?.runtime ?? (active ? 'API' : '—')}
      </span>
      <ProviderStatusBadge status={provider.status} reasons={reasonsOf(provider)} />
      <span className="text-xs" data-testid={`limit-${provider.slug}`}>
        {narrow ? (
          <span className="text-muted-foreground">{t('providers.list.limit')}: </span>
        ) : null}
        <LimitCell until={provider.limitUntil} />
      </span>
    </span>
  );
}

/** The providers with level, working access, status and limit; a row opens the form. */
export function ProvidersList({
  rows,
  selected,
  narrow,
  onOpen,
}: {
  rows: ProviderRow[];
  selected: string | null;
  narrow: boolean;
  onOpen: (row: ProviderRow) => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('providers.list.label')} className="flex flex-col gap-2">
      {!narrow ? (
        <div
          aria-hidden
          className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_8rem_minmax(0,1.6fr)_minmax(0,1.2fr)] gap-x-3 px-3 text-xs text-muted-foreground"
        >
          <span>{t('providers.list.name')}</span>
          <span>{t('providers.list.level')}</span>
          <span>{t('providers.list.access')}</span>
          <span>{t('providers.list.status')}</span>
          <span>{t('providers.list.limit')}</span>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              aria-current={selected === row.key ? 'true' : undefined}
              data-selected={selected === row.key ? 'true' : undefined}
              onClick={() => onOpen(row)}
              className={cn(
                'w-full rounded-lg border bg-card px-3 py-2 hover:bg-accent',
                selected === row.key && 'ring-2 ring-primary',
                !row.provider.enabled && 'opacity-60',
              )}
            >
              <RowBody row={row} narrow={narrow} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
