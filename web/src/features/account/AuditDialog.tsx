import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { AuditEventView } from '../../shared/api/types.ts';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Input } from '../../shared/ui/forms/input.tsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../shared/ui/overlays/dialog.tsx';

import { listAudit, type AuditFilter } from './accountApi.ts';

/** How far back the journal can be read from the page. */
const PERIODS = ['1h', '1d', '7d', '30d'] as const;

const EMPTY: AuditFilter = { user: '', repository: '', action: '', since: '7d' };

/** The details of an entry on one line: `group=login · answer=yes`. */
function detailsText(event: AuditEventView): string {
  return Object.entries(event.details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}

/** The filters of the journal: user, project, action prefix and period. */
function AuditFilters({
  filter,
  setFilter,
  onShow,
}: {
  filter: AuditFilter;
  setFilter: Dispatch<SetStateAction<AuditFilter>>;
  onShow: () => void;
}) {
  const { t } = useTranslation();
  const change = (key: keyof AuditFilter) => (event: { target: { value: string } }) =>
    setFilter((previous) => ({ ...previous, [key]: event.target.value }));
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onShow();
      }}
    >
      <Input
        className="w-48"
        value={filter.user}
        onChange={change('user')}
        placeholder={t('account.audit.user')}
        aria-label={t('account.audit.user')}
      />
      <Input
        className="w-40"
        value={filter.repository}
        onChange={change('repository')}
        placeholder={t('account.audit.project')}
        aria-label={t('account.audit.project')}
      />
      <Input
        className="w-40"
        value={filter.action}
        onChange={change('action')}
        placeholder={t('account.audit.action')}
        aria-label={t('account.audit.action')}
      />
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={filter.since}
        onChange={change('since')}
        aria-label={t('account.audit.period')}
      >
        {PERIODS.map((period) => (
          <option key={period} value={period}>
            {t(`account.audit.periods.${period}`)}
          </option>
        ))}
      </select>
      <Button type="submit">{t('account.audit.show')}</Button>
    </form>
  );
}

/** The entries, the newest first; the text of the error or the empty note otherwise. */
function AuditTable({ events, error }: { events: AuditEventView[]; error: string | null }) {
  const { t } = useTranslation();
  return events.length === 0 && error === null ? (
    <p className="text-sm text-muted-foreground">{t('account.audit.empty')}</p>
  ) : (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-left text-xs">
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b align-top">
              <td className="whitespace-nowrap pr-2 text-muted-foreground">
                {new Date(event.at).toLocaleString()}
              </td>
              <td className="pr-2" title={event.subject}>
                {event.user?.email ?? event.subject}
              </td>
              <td className="pr-2 font-mono">{event.action}</td>
              <td className="pr-2" data-outcome={event.outcome}>
                {t(`account.audit.outcomes.${event.outcome}`)}
              </td>
              <td className="break-words">
                {[
                  event.resourceKind === null
                    ? ''
                    : `${event.resourceKind} ${event.resourceId ?? ''}`.trim(),
                  detailsText(event),
                  event.error ?? '',
                ]
                  .filter((part) => part !== '')
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** «Journal» for an administrator: who did what, newest first, by user, project, action and period. */
export function AuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((wanted: AuditFilter) => {
    setError(null);
    listAudit(wanted).then(setEvents, (reason: Error) => setError(reason.message));
  }, []);
  useEffect(() => {
    if (open) load(EMPTY);
  }, [open, load]);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('account.audit.title')}</DialogTitle>
        </DialogHeader>
        <AuditFilters filter={filter} setFilter={setFilter} onShow={() => load(filter)} />
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AuditTable events={events} error={error} />
      </DialogContent>
    </Dialog>
  );
}
