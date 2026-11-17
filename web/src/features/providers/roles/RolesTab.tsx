import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import { RoleDialogHost, RolesFailure } from './RoleDialogs.tsx';
import { RoleRow } from './RoleRow.tsx';
import { canMove } from './edit.ts';
import { useRoleActions, type Level } from './useRoleActions.ts';

/** The roles of the configuration: a level to write, add, rename, reorder, remove. */
export function RolesTab({
  api,
  repository,
  view,
  editor,
  allProjects,
}: {
  api: Api;
  repository: string | null;
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  allProjects: boolean;
}) {
  const { t } = useTranslation();
  const [chosen, setLevel] = useState<Level>('global');
  const level: Level = allProjects ? 'global' : chosen;
  const actions = useRoleActions({ api, repository, view, editor, level });
  const { dialog } = actions;
  const target =
    dialog && dialog.kind !== 'add' ? view.roles.find((r) => r.slug === dialog.slug) : null;
  return (
    <section aria-label={t('providers.roles.label')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          type="single"
          value={level}
          aria-label={t('providers.roles.level')}
          onValueChange={(next) => next && setLevel(next as Level)}
        >
          <ToggleGroupItem value="global">{t('providers.level.global')}</ToggleGroupItem>
          <ToggleGroupItem value="project" disabled={allProjects}>
            {t('providers.level.project')}
          </ToggleGroupItem>
        </ToggleGroup>
        <Button size="sm" disabled={!editor} onClick={() => actions.setDialog({ kind: 'add' })}>
          <Plus /> {t('providers.roles.add')}
        </Button>
      </div>
      {allProjects ? (
        <p className="text-xs text-muted-foreground">{t('providers.allProjectsHint')}</p>
      ) : null}
      <RolesFailure message={actions.failure} />
      {view.roles.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          {t('providers.empty.noRoles')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.roles.map((role) => (
            <RoleRow
              key={role.slug}
              role={role}
              count={view.providers.filter((provider) => role.slug in provider.models).length}
              selected={actions.selected === role.slug}
              ready={editor !== null}
              inLevel={role.slug in actions.record}
              canUp={canMove(actions.movable, role.slug, -1)}
              canDown={canMove(actions.movable, role.slug, 1)}
              onSelect={() => actions.select(role.slug)}
              onRename={() => actions.setDialog({ kind: 'rename', slug: role.slug })}
              onMove={(step) => actions.move(role.slug, step)}
              onRemove={() => void actions.askRemove(role.slug, role.name)}
            />
          ))}
        </ul>
      )}
      <RoleDialogHost api={api} editor={editor} view={view} actions={actions} />
    </section>
  );
}
