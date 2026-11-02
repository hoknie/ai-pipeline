import { cn } from '../../lib/cn.ts';

/** One row style for every item of the navigation panel, so the icons share one axis. */
export function navRowClass(): string {
  return cn(
    'flex h-8 w-full shrink-0 items-center gap-2 justify-start rounded-md px-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0',
  );
}
