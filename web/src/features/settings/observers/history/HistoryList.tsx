import { useTranslation } from 'react-i18next';
import type { ObserverHistoryPage } from '../../../../shared/api/observerHistoryApi.ts';
import { HistoryCard, HistoryItem } from './HistoryItem.tsx';

export function HistoryList({ page, asOf }: { page: ObserverHistoryPage; asOf?: number }) {
  const { t } = useTranslation();
  const headings = ['run', 'project', 'runtime', 'model', 'started', 'result', 'usage'];
  return (
    <>
      <div className="hidden overflow-x-auto @min-[64rem]:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr>
              {headings.map((heading) => (
                <th key={heading} className="p-2">
                  {t(`observers.history.${heading}` as never)}
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
      <div className="grid gap-2 @min-[64rem]:hidden">
        {page.items.map((item) => (
          <HistoryCard key={item.id} item={item} asOf={asOf ?? page.asOf} />
        ))}
      </div>
    </>
  );
}
