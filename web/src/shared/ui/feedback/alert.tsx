import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

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
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
