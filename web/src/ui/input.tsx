import type { ComponentProps } from 'react';

import { cn } from '../lib/cn.ts';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
