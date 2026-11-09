import { cn } from '../../lib/browser/cn.ts';
import { repositoryColor } from '../../lib/catalog/repositories.ts';

/** Solid shades of the palette for the dot of a project; written out so Tailwind finds them. */
export const PROJECT_DOT_CLASSES: Record<string, string> = {
  gray: 'bg-[#6b7280]',
  red: 'bg-[#ef4444]',
  orange: 'bg-[#f97316]',
  yellow: 'bg-[#eab308]',
  green: 'bg-[#22c55e]',
  teal: 'bg-[#14b8a6]',
  blue: 'bg-[#3b82f6]',
  violet: 'bg-[#8b5cf6]',
  pink: 'bg-[#ec4899]',
  brown: 'bg-[#b45309]',
};

/**
 * The colored dot of a project, before its name. Nothing without a color: a project without one
 * and a path outside the registry show only the name. `color` overrides the registry's.
 */
export function ProjectDot({
  path,
  color,
  className,
}: {
  path?: string;
  color?: string | null;
  className?: string;
}) {
  const shade = color === undefined ? (path ? repositoryColor(path) : null) : color;
  if (shade === null || !(shade in PROJECT_DOT_CLASSES)) return null;
  return (
    <span
      aria-hidden="true"
      data-project-color={shade}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        PROJECT_DOT_CLASSES[shade],
        className,
      )}
    />
  );
}
