import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn.ts';

/** Empty state: an icon, a title, a hint and optional actions. */
export function Empty({
  icon,
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & { icon?: ReactNode; title: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground',
        className,
      )}
      {...props}
    >
      {icon ? <div className="text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <p className="font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}
