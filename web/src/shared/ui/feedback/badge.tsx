import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/browser/cn.ts';

export const badgeVariants = cva(
  'inline-flex max-w-full items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        outline: 'border-border text-foreground',
        run: 'bg-status-run-bg text-status-run',
        warn: 'bg-status-warn-bg text-status-warn',
        err: 'bg-status-err-bg text-status-err',
        ok: 'bg-status-ok-bg text-status-ok',
        mute: 'bg-status-mute-bg text-status-mute',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
