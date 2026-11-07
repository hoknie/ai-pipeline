import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import type { View } from '../../../shared/lib/nav/route.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';

/** Counter of a section: runs in progress (tone follows the runs waiting for an answer) or tasks in the queue. */
export function NavCounter({
  target,
  count,
  waiting,
  corner = false,
  className,
}: {
  className?: string;
  target: View;
  count: number;
  waiting: number;
  /** Sits on the corner of the section icon instead of a row; a large number is shortened. */
  corner?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={target === 'runs' ? (waiting > 0 ? 'warn' : 'run') : 'mute'}
      aria-label={
        target === 'runs'
          ? waiting > 0
            ? t('nav.workingWaiting', { count, waiting })
            : t('nav.working', { count })
          : t('nav.queued', { count })
      }
      className={cn(
        corner && 'absolute -right-2 -top-2 min-w-4 justify-center px-1 py-0 text-[10px] leading-4',
        className,
      )}
    >
      {corner && count > 99 ? '99+' : count}
    </Badge>
  );
}
