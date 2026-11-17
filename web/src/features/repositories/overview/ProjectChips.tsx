import { useTranslation } from 'react-i18next';

import type { EntryLevel } from '../../../shared/api/types.ts';
import type { Presence } from '../../../shared/lib/catalog/projectRows.ts';
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

/** Under the title of a row: «In all projects», or the projects that have the entry. */
export function ProjectChips({
  everywhere,
  presences,
}: {
  everywhere: boolean;
  presences: readonly Presence<{ level: EntryLevel }>[];
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
  return (
    <span data-project-chips="projects" className="flex flex-wrap gap-x-3 gap-y-1">
      {presences.map(({ project, entry }) => {
        const level = levelLabel(entry.level);
        return (
          <span
            key={project.path}
            data-project-label={project.slug}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ProjectDot color={project.color} />
            {project.label}
            {level ? <span className="opacity-70">· {level}</span> : null}
          </span>
        );
      })}
    </span>
  );
}
