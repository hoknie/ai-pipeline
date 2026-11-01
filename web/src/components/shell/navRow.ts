import { cn } from '../../lib/cn.ts';

/** One row style for every item of the navigation, so the icons share one axis. */
export function navRowClass(collapsed: boolean): string {
  return cn(
    'flex h-8 w-full shrink-0 items-center gap-2 rounded-md text-sm [&_svg]:size-4 [&_svg]:shrink-0',
    collapsed ? 'justify-center px-0' : 'justify-start px-2',
  );
}
