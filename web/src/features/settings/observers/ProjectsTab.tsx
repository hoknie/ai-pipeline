import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { Card } from '../../../shared/ui/layout/card.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { Errors } from './Errors.tsx';
import type { ErrorGroups, Form, ProjectDraft } from './form.ts';

/** The projects the observers work in, and the limit of each. */
export function ProjectsTab({
  form,
  update,
  busy,
  order,
  errors,
}: {
  form: Form;
  update: (patch: Partial<Form>) => void;
  busy: boolean;
  order: string[];
  errors: ErrorGroups;
}) {
  const { t } = useTranslation();
  const projectErrors = errors.project;
  return (
    <Card>
      <section className="flex flex-col gap-3 p-4" aria-label={t('observers.tabs.projects')}>
        <p className="text-sm text-muted-foreground">{t('observers.projects.hint')}</p>
        {order.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('observers.projects.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {order.map((repository, index) => {
              const project = form.projects[repository] ?? { connected: false, maxWorkers: '' };
              const name = repositoryLabel(repository);
              const own = projectErrors(repository);
              const change = (patch: Partial<ProjectDraft>) =>
                update({
                  projects: { ...form.projects, [repository]: { ...project, ...patch } },
                });
              return (
                <li key={repository} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`observers-project-${index}`}
                      checked={project.connected}
                      disabled={busy}
                      aria-label={t('observers.projects.connect', { name })}
                      onCheckedChange={(connected) => change({ connected })}
                    />
                    <Label htmlFor={`observers-project-${index}`} title={repository}>
                      {name}
                    </Label>
                    <code className="truncate text-xs text-muted-foreground">{repository}</code>
                  </div>
                  <div className="flex items-center gap-2 pl-11">
                    <Label htmlFor={`observers-project-workers-${index}`} className="text-xs">
                      {t('observers.projects.maxWorkers')}
                    </Label>
                    <Input
                      id={`observers-project-workers-${index}`}
                      type="number"
                      min={1}
                      className="w-24"
                      value={project.maxWorkers}
                      disabled={busy || !project.connected}
                      aria-label={t('observers.projects.maxWorkersOf', { name })}
                      aria-invalid={own.length > 0}
                      onChange={(event) => change({ maxWorkers: event.target.value })}
                    />
                  </div>
                  <div className="pl-11">
                    <Errors errors={own} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}
