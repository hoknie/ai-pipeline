import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';

type PageSize = 20 | 50 | 100;

type HistoryControls = {
  page: { nextCursor: string | null } | null;
  busy: boolean;
  canBack: boolean;
  pageNumber: number;
  back: () => void;
  next: () => void;
};

/** The rows per page at the left, the page and the moves at the right. */
export function HistoryPagination({
  history,
  pageSize,
  onPageSize,
}: {
  history: HistoryControls;
  pageSize?: PageSize;
  onPageSize?: (size: PageSize) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"
      aria-label={t('observers.history.pagination')}
    >
      {onPageSize ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('observers.history.pageSize')}
          <Select
            value={String(pageSize ?? 20)}
            onValueChange={(value) => onPageSize(Number(value) as PageSize)}
          >
            <SelectTrigger className="h-8 w-20" aria-label={t('observers.history.pageSize')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[20, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('observers.history.pageLabel', { page: history.pageNumber })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!history.canBack || history.busy}
          onClick={history.back}
        >
          <ChevronLeft aria-hidden="true" />
          {t('observers.history.back')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!history.page?.nextCursor || history.busy}
          onClick={history.next}
        >
          {t('observers.history.next')}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
