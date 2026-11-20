import { useTranslation } from 'react-i18next';

import type { DeliveryView } from '../../shared/api/types.ts';
import { Badge } from '../../shared/ui/feedback/badge.tsx';

const stateVariant = { sent: 'ok', failed: 'err', pending: 'warn', closed: 'mute' } as const;

const when = (ms: number): string => new Date(ms).toLocaleString();

/** The lines of the journal, the newest first; an error is the safe text the channel gave. */
export function JournalTable({ rows }: { rows: readonly DeliveryView[] }) {
  const { t } = useTranslation();
  return (
    <table className="w-full text-left text-sm" data-testid="journal">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="pr-3">{t('integrations.journal.when')}</th>
          <th className="pr-3">{t('integrations.journal.event')}</th>
          <th className="pr-3">{t('integrations.journal.state')}</th>
          <th className="pr-3">{t('integrations.journal.attempts')}</th>
          <th>{t('integrations.journal.error')}</th>
        </tr>
      </thead>
      <tbody>
        {(rows ?? []).map((row) => (
          <tr key={row.id}>
            <td className="pr-3 whitespace-nowrap">{when(row.createdAt)}</td>
            <td className="pr-3">
              {row.kind === 'test'
                ? t('integrations.journal.test')
                : `${t(`integrations.events.${row.kind}`)} · ${row.run}${row.group === null ? '' : `/${row.group}`}`}
            </td>
            <td className="pr-3">
              <Badge variant={stateVariant[row.state]}>
                {t(`integrations.journal.states.${row.state}`)}
              </Badge>
            </td>
            <td className="pr-3">{row.attempts}</td>
            <td className="text-status-err">{row.error ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
