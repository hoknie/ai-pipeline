import { ListOrdered, Settings2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RepositoryView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import type { ProjectActions } from './ProjectForm.tsx';

/** What a project holds, read only: when it was added and its runs and tasks. */
export function ProjectFacts({ project }: { project: RepositoryView }) {
  const { t } = useTranslation();
  const facts: [string, string][] = [
    [t('projects.facts.added'), new Date(project.addedAt).toLocaleString()],
    [t('projects.facts.unfinished'), String(project.unfinished)],
    [t('projects.facts.waiting'), String(project.waiting)],
    [t('projects.facts.queued'), String(project.queued)],
  ];
  return (
    <dl
      aria-label={t('projects.facts.label')}
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
    >
      {facts.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd data-fact={term}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The links to the project's settings and queue, and its removal from the list. */
export function ProjectLinks({
  project,
  actions,
}: {
  project: RepositoryView;
  actions: ProjectActions;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!project.enabled}
          onClick={() => actions.onOpen(project.path, 'settings')}
        >
          <Settings2 aria-hidden />
          {t('projects.links.settings')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!project.enabled}
          onClick={() => actions.onOpen(project.path, 'queue')}
        >
          <ListOrdered aria-hidden />
          {t('projects.links.queue')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-destructive"
          onClick={() => void actions.onRemove(project.path)}
        >
          <Trash2 aria-hidden />
          {t('nav.repositoryRemove')}
        </Button>
      </div>
      {project.enabled ? null : (
        <p className="text-sm text-muted-foreground">{t('projects.links.disabled')}</p>
      )}
    </div>
  );
}
