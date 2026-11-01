import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn.ts';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-input bg-card data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
