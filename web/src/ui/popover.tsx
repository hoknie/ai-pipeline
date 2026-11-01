import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn.ts';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-[var(--radix-popover-trigger-width)] min-w-72 max-w-[min(32rem,90vw)] rounded-md border bg-card text-card-foreground shadow-md outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
