import { useTranslation } from 'react-i18next';
import type { ObserverHistoryPage } from '../../../../shared/api/observerHistoryApi.ts';
import { HistoryCard, HistoryItem } from './HistoryItem.tsx';

const COLUMNS = [
  { key: 'run', width: 'w-[30%]' },
  { key: 'project', width: 'w-[16%]' },
  { key: 'runtimeModel', width: 'w-[16%]' },
  { key: 'started', width: 'w-[16%]' },
  { key: 'result', width: 'w-[12%]' },
  { key: 'usage', width: 'w-[10%]' },
] as const;

/** A table in a wide area of the history, cards in a narrow one. */
export function HistoryList({ page, asOf }: { page: ObserverHistoryPage; asOf?: number }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="hidden overflow-x-auto @min-[64rem]:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            {COLUMNS.map((column) => (
              <col key={column.key} className={column.width} />
            ))}
          </colgroup>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-2 font-medium ${column.key === 'usage' ? 'text-right' : ''}`}
                >
                  {t(`observers.history.${column.key}` as never)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((item) => (
              <HistoryItem key={item.id} item={item} asOf={asOf ?? page.asOf} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col divide-y @min-[64rem]:hidden">
        {page.items.map((item) => (
          <HistoryCard key={item.id} item={item} asOf={asOf ?? page.asOf} />
        ))}
      </div>
    </>
  );
}
