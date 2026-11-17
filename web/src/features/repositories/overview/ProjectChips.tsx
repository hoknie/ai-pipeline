import { useTranslation } from 'react-i18next';

import type { EntryLevel } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import type { Presence } from '../../../shared/lib/catalog/projectRows.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';

/** The label of a level of an entry that a project has of its own; none for a shared one. */
export function useLevelLabel() {
  const { t } = useTranslation();
  return (level: EntryLevel): string | null =>
    level === 'project'
      ? t('projectOverview.project')
      : level === 'project_over_global'
        ? t('projectOverview.overrides')
        : null;
}

/**
 * Under the title of a row: «In all projects», or a badge per project with an entry of its own
 * (a project that uses the shared entry as it is has none); whether the project overrides the
 * shared entry is in the tooltip. `className` replaces the row layout, for example `contents` to
 * share one row with other badges.
 */
export function ProjectChips({
  everywhere,
  presences,
  className,
}: {
  everywhere: boolean;
  presences: readonly Presence<{ level: EntryLevel }>[];
  className?: string;
}) {
  const { t } = useTranslation();
  const levelLabel = useLevelLabel();
  if (everywhere) {
    return (
      <span data-project-chips="everywhere" className="text-xs text-muted-foreground">
        {t('projectOverview.everywhere')}
      </span>
    );
  }
  const own = presences.filter(({ entry }) => entry.level !== 'global');
  if (own.length === 0) return null;
  return (
    <span data-project-chips="projects" className={cn('flex flex-wrap gap-1', className)}>
      {own.map(({ project, entry }) => (
        <Badge
          key={project.path}
          variant="outline"
          data-project-label={project.slug}
          title={levelLabel(entry.level) ?? undefined}
          className="text-muted-foreground"
        >
          <ProjectDot color={project.color} />
          {project.label}
        </Badge>
      ))}
    </span>
  );
}
