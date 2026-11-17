import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/browser/cn.ts';

const alertVariants = cva('relative w-full rounded-lg border px-3 py-2 text-sm', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      warn: 'border-status-warn/30 bg-status-warn-bg text-status-warn',
      destructive: 'border-status-err/30 bg-status-err-bg text-status-err',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({
  className,
  variant,
  onDismiss,
  children,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants> & { onDismiss?: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), onDismiss && 'flex items-start gap-2', className)}
      {...props}
    >
      {onDismiss ? <div className="min-w-0 flex-1">{children}</div> : children}
      {onDismiss ? (
        <button
          type="button"
          aria-label={t('common.close')}
          title={t('common.close')}
          className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
