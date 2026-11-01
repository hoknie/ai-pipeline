import type { ComponentProps } from 'react';

import { cn } from '../lib/cn.ts';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-16 w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
