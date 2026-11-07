import { Toolbar as ToolbarPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/browser/cn.ts';

export function Toolbar({ className, ...props }: ComponentProps<typeof ToolbarPrimitive.Root>) {
  return (
    <ToolbarPrimitive.Root
      className={cn('flex flex-wrap items-center gap-1', className)}
      {...props}
    />
  );
}

export function ToolbarButton({
  className,
  ...props
}: ComponentProps<typeof ToolbarPrimitive.Button>) {
  return (
    <ToolbarPrimitive.Button
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function ToolbarToggleGroup({
  className,
  ...props
}: ComponentProps<typeof ToolbarPrimitive.ToggleGroup>) {
  return (
    <ToolbarPrimitive.ToggleGroup
      className={cn('inline-flex w-fit items-center rounded-md border bg-muted p-0.5', className)}
      {...props}
    />
  );
}

export function ToolbarToggleItem({
  className,
  ...props
}: ComponentProps<typeof ToolbarPrimitive.ToggleItem>) {
  return (
    <ToolbarPrimitive.ToggleItem
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-xs font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function ToolbarSeparator({
  className,
  ...props
}: ComponentProps<typeof ToolbarPrimitive.Separator>) {
  return (
    <ToolbarPrimitive.Separator className={cn('mx-1 h-5 w-px bg-border', className)} {...props} />
  );
}
