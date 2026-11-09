import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepositoryView } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { EntryList, SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { NewProjectForm } from './NewProjectForm.tsx';
import { ProjectForm, type ProjectActions } from './ProjectForm.tsx';
import { NEW_PROJECT, projectMatches, sortedProjects } from './projectDraft.ts';

export interface ProjectsGroupProps extends Omit<ProjectActions, 'onSlug'> {
  registry: RepositoryView[];
  /** The slug of the open project, `new` for the form of a new one, or null. */
  selected: string | null;
  onSelect: (slug: string | null) => void;
}

/** The list on the left: «Add project», the search and every project, disabled ones too. */
function ProjectsSide({
  registry,
  selected,
  go,
}: {
  registry: RepositoryView[];
  selected: string | null;
  go: (slug: string | null) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const shown = sortedProjects(registry).filter((project) => projectMatches(project, search));
  return (
    <>
      <Button onClick={() => go(NEW_PROJECT)}>
        <Plus />
        {t('projects.add')}
      </Button>
      <Input
        type="search"
        value={search}
        aria-label={t('projects.search')}
        placeholder={t('projects.search')}
        onChange={(event) => setSearch(event.target.value)}
      />
      {registry.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('projects.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('projects.nothing')}</p>
      ) : null}
      <EntryList
        label={t('projects.list')}
        selected={selected}
        onSelect={go}
        entries={shown.map((project) => ({
          id: project.slug,
          hint: project.path,
          title: (
            <span className="flex min-w-0 items-center gap-1.5">
              <ProjectDot color={project.color} />
              <span className="truncate">{project.label}</span>
              {project.waiting > 0 ? (
                <Badge
                  variant="warn"
                  aria-label={t('nav.repositoryWaiting', { count: project.waiting })}
                >
                  {project.waiting}
                </Badge>
              ) : null}
            </span>
          ),
          subtitle: `${project.slug} · ${project.displayPath}`,
          ...(project.enabled ? {} : { tag: t('projects.disabled') }),
        }))}
      />
    </>
  );
}

/** The group «Projects» of the shared tab: every project of the registry and its form. */
export function ProjectsGroup(props: ProjectsGroupProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { registry, selected, onSelect, dirty } = props;
  const go = async (slug: string | null) => {
    if (slug === selected) return;
    if (
      dirty.current &&
      !(await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    dirty.current = false;
    onSelect(slug);
  };
  const actions: ProjectActions = {
    ...props,
    onSlug: (slug) => onSelect(slug),
    onRemove: async (path) => {
      const removed = await props.onRemove(path);
      if (removed) onSelect(null);
      return removed;
    },
  };
  const project = registry.find((entry) => entry.slug === selected);
  return (
    <SplitPage
      side={<ProjectsSide registry={registry} selected={selected} go={(slug) => void go(slug)} />}
    >
      {selected === NEW_PROJECT ? (
        <NewProjectForm registry={registry} actions={actions} />
      ) : project ? (
        <ProjectForm key={project.path} project={project} actions={actions} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('projects.choose')}</p>
      )}
    </SplitPage>
  );
}
