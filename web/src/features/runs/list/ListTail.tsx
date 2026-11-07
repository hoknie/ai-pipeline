import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';

/** The end of the list: the error with a retry, or the marker that loads older runs. */
export function ListTail({
  more,
  onMore,
  setMarker,
}: {
  more: 'idle' | 'loading' | 'error' | 'done';
  onMore: () => void;
  setMarker: (element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  return more === 'done' ? null : more === 'error' ? (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
      {t('runs.list.moreFailed')}
      <Button variant="outline" size="sm" onClick={onMore}>
        {t('runs.list.retry')}
      </Button>
    </div>
  ) : (
    <div
      ref={setMarker}
      role={more === 'loading' ? 'status' : undefined}
      aria-label={more === 'loading' ? t('runs.list.loadingMore') : undefined}
      data-run-list-end=""
      className="flex flex-col gap-2"
    >
      {more === 'loading' ? <Skeleton className="h-16" /> : <div className="h-4" />}
    </div>
  );
}
