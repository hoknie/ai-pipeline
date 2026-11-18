import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { RuntimeStatus } from './RuntimeStatus.tsx';
import type { RuntimeRow } from './runtimeRows.ts';

const COLUMNS = 'grid-cols-[minmax(0,2fr)_8rem_minmax(0,1.5fr)_minmax(0,1.5fr)_6rem]';

function RowBody({ row, title, narrow }: { row: RuntimeRow; title: string; narrow: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'grid w-full items-center gap-x-3 gap-y-1 text-left',
        narrow ? 'grid-cols-1' : COLUMNS,
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">{row.key}</span>
      </span>
      <RuntimeStatus enabled={row.enabled} />
      <span className="truncate text-sm" title={row.command}>
        {row.command || '—'}
      </span>
      {narrow ? null : (
        <>
          <span className="truncate text-xs text-muted-foreground" title={row.args.join(' ')}>
            {row.args.length > 0 ? row.args.join(' ') : '—'}
          </span>
          <span className="text-xs" aria-label={t('settingsPage.runtimes.columns.env')}>
            {row.envCount}
          </span>
        </>
      )}
    </span>
  );
}

/** The runtimes with state and command; a row opens the form. The wide form adds a header. */
export function RuntimesList({
  rows,
  selected,
  narrow,
  titleOf,
  onOpen,
}: {
  rows: RuntimeRow[];
  selected: string | null;
  narrow: boolean;
  titleOf: (key: string) => string;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('settingsPage.runtimes.list')} className="flex flex-col gap-2">
      {!narrow ? (
        <div aria-hidden className={cn('grid gap-x-3 px-3 text-xs text-muted-foreground', COLUMNS)}>
          <span>{t('settingsPage.runtimes.columns.runtime')}</span>
          <span>{t('settingsPage.runtimes.columns.state')}</span>
          <span>{t('settingsPage.runtimes.columns.command')}</span>
          <span>{t('settingsPage.runtimes.columns.args')}</span>
          <span>{t('settingsPage.runtimes.columns.env')}</span>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              aria-current={selected === row.key ? 'true' : undefined}
              data-selected={selected === row.key ? 'true' : undefined}
              onClick={() => onOpen(row.key)}
              className={cn(
                'w-full rounded-lg border bg-card px-3 py-2 hover:bg-accent',
                selected === row.key && 'ring-2 ring-primary',
                !row.enabled && 'opacity-60',
              )}
            >
              <RowBody row={row} title={titleOf(row.key)} narrow={narrow} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
