import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/ui/forms/button.tsx';

type HistoryControls = {
  page: { nextCursor: string | null } | null;
  busy: boolean;
  canBack: boolean;
  pageNumber: number;
  back: () => void;
  next: () => void;
};

export function HistoryPagination({ history }: { history: HistoryControls }) {
  const { t } = useTranslation();
  return (
    <nav
      className="flex items-center justify-between"
      aria-label={t('observers.history.pagination')}
    >
      <Button variant="outline" disabled={!history.canBack || history.busy} onClick={history.back}>
        {t('observers.history.back')}
      </Button>
      <span className="text-sm font-medium">
        {t('observers.history.pageLabel', { page: history.pageNumber })}
      </span>
      <Button
        variant="outline"
        disabled={!history.page?.nextCursor || history.busy}
        onClick={history.next}
      >
        {t('observers.history.next')}
      </Button>
    </nav>
  );
}
