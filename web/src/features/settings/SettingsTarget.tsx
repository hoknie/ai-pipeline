import { useTranslation } from 'react-i18next';

import { cn } from '../../shared/lib/browser/cn.ts';
import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import type { SettingsScope } from '../../shared/lib/nav/settingsGroups.ts';
import { ProjectDot } from '../../shared/ui/feedback/ProjectDot.tsx';
import { Card } from '../../shared/ui/layout/card.tsx';
import { Label } from '../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/ui/forms/select.tsx';
import { FilePath } from '../../shared/ui/layout/FilePath.tsx';
import { hrefOf } from './page/hrefOf.ts';

/** The group «Projects», where a project is added or enabled. */
const PROJECTS_LINK = hrefOf('global', 'projects');

/** The project tab without a project to choose: none at all, or only disabled ones. */
function NoProjects({ anyProject }: { anyProject: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-muted-foreground">
      {anyProject ? (
        <>
          {t('settingsPage.noEnabledProjects')}{' '}
          <a className="underline" href={PROJECTS_LINK}>
            {t('settingsPage.group.projects')}
          </a>
        </>
      ) : (
        t('settingsPage.noProjects')
      )}
    </p>
  );
}

/**
 * The block under the tabs: the project of the «Project» tab and the file the open group saves
 * to. Renders nothing when there is nothing to show.
 */
export function SettingsTarget({
  scope,
  repository,
  repositories,
  onSelectRepository,
  file,
  note = null,
  anyProject = repositories.length > 0,
}: {
  scope: SettingsScope;
  repository: string | null;
  repositories: string[];
  onSelectRepository: (path: string) => void;
  /** The file the open group saves to; null when the group does not show it. */
  file: string | null;
  /** Text instead of a file for a group that saves to many files; null for none. */
  note?: string | null;
  /** Whether the registry has any project, enabled or not. */
  anyProject?: boolean;
}) {
  const { t } = useTranslation();
  if (scope === 'global' && !file && !note) return null;
  const empty = scope === 'project' && repositories.length === 0;

  return (
    <Card
      role="region"
      aria-label={t('settingsPage.target')}
      className="flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center"
    >
      {scope === 'project' ? (
        empty ? (
          <NoProjects anyProject={anyProject} />
        ) : (
          <div className="flex min-w-0 flex-col gap-1 sm:w-72 sm:shrink-0">
            <Label htmlFor="settings-project">{t('settingsPage.project')}</Label>
            <Select value={repository ?? ''} onValueChange={onSelectRepository}>
              <SelectTrigger id="settings-project" className="w-full" title={repository ?? ''}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((path) => (
                  <SelectItem key={path} value={path} title={path}>
                    <span className="flex items-center gap-1.5">
                      <ProjectDot path={path} />
                      {repositoryLabel(path)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {repository ? (
              <p className="truncate text-xs text-muted-foreground" title={repository}>
                {repository}
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {note && !file ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {file && !empty ? (
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1',
            scope === 'project' && 'sm:ml-auto sm:justify-end',
          )}
        >
          <span className="text-sm font-medium">{t('settingsPage.writesTo')}</span>
          <FilePath path={file} variant="line" />
          {scope === 'global' ? (
            <span className="text-xs text-muted-foreground">{t('settingsPage.globalNote')}</span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
