import { useTranslation } from 'react-i18next';

import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';

export function Loading({ what }: { what: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('app.loading', { what })} className="flex flex-col gap-2 p-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40" />
    </div>
  );
}
