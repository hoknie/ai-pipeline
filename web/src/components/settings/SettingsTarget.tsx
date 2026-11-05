import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
import type { SettingsScope } from '../../settingsGroups.ts';
import { Card } from '../../ui/card.tsx';
import { Label } from '../../ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.tsx';
import { FilePath } from '../FilePath.tsx';

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
}: {
  scope: SettingsScope;
  repository: string | null;
  repositories: string[];
  onSelectRepository: (path: string) => void;
  /** The file the open group saves to; null when the group does not show it. */
  file: string | null;
  /** Text instead of a file for a group that saves to many files; null for none. */
  note?: string | null;
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
          <p className="text-sm text-muted-foreground">{t('settingsPage.noProjects')}</p>
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
                    {repositoryLabel(path)}
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
