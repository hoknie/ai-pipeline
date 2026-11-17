import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import { SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { ReadOnlyHint } from '../../repositories/index.ts';
import { useProvidersScope } from '../page/scope.ts';
import { RoleDetails } from './RoleDetails.tsx';
import { RoleDialogHost, RolesFailure } from './RoleDialogs.tsx';
import { RoleRow } from './RoleRow.tsx';
import { canMove } from './edit.ts';
import { useRoleActions, type Level } from './useRoleActions.ts';

/** The column of the roles: the level to write, «Add role» and the list. */
function RolesSide({
  view,
  editor,
  level,
  readOnly,
  actions,
  onLevel,
}: {
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  level: Level;
  readOnly: boolean;
  actions: ReturnType<typeof useRoleActions>;
  onLevel: (level: Level) => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  return (
    <section aria-label={t('providers.roles.label')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {scope === 'project' && !readOnly ? (
          <ToggleGroup
            type="single"
            value={level}
            aria-label={t('providers.roles.level')}
            onValueChange={(next) => next && onLevel(next as Level)}
          >
            <ToggleGroupItem value="global">{t('providers.level.global')}</ToggleGroupItem>
            <ToggleGroupItem value="project">{t('providers.level.project')}</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {readOnly ? null : (
          <Button size="sm" disabled={!editor} onClick={() => actions.setDialog({ kind: 'add' })}>
            <Plus /> {t('providers.roles.add')}
          </Button>
        )}
      </div>
      {readOnly ? <ReadOnlyHint /> : null}
      {view.roles.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          {t('providers.empty.noRoles')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.roles.map((item) => (
            <RoleRow
              key={item.slug}
              role={item}
              count={view.providers.filter((provider) => item.slug in provider.models).length}
              selected={actions.selected === item.slug}
              onSelect={() => actions.select(item.slug)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The roles: the list on the left, the open role with its models by provider on the right. */
export function RolesTab({
  api,
  repository,
  view,
  editor,
  readOnly,
  onProviders,
}: {
  api: Api;
  repository: string | null;
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  /** The mode «All projects»: the roles are shown, nothing is written. */
  readOnly: boolean;
  /** Opens the tab «Providers» (the hint of a swarm without providers). */
  onProviders?: () => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const [chosen, setLevel] = useState<Level>('global');
  const level: Level = readOnly || scope === 'global' ? 'global' : chosen;
  const actions = useRoleActions({
    api,
    repository,
    view,
    editor: readOnly ? null : editor,
    level,
  });
  const role = view.roles.find((item) => item.slug === actions.selected);
  return (
    <SplitPage
      side={
        <RolesSide
          view={view}
          editor={editor}
          level={level}
          readOnly={readOnly}
          actions={actions}
          onLevel={setLevel}
        />
      }
    >
      <RolesFailure message={actions.failure} />
      {role ? (
        <RoleDetails
          api={api}
          repository={repository}
          view={view}
          editor={editor}
          role={role}
          readOnly={readOnly}
          actions={{
            ready: editor !== null,
            inLevel: role.slug in actions.record,
            canUp: canMove(actions.movable, role.slug, -1),
            canDown: canMove(actions.movable, role.slug, 1),
            onRename: () => actions.setDialog({ kind: 'rename', slug: role.slug }),
            onMove: (step) => actions.move(role.slug, step),
            onRemove: () => void actions.askRemove(role.slug, role.name),
          }}
        />
      ) : (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>{t('providers.roles.detailsEmpty')}</p>
          {view.providers.length === 0 && onProviders ? (
            <button type="button" className="w-fit underline" onClick={onProviders}>
              {t('swarm.hints.toProviders')}
            </button>
          ) : null}
        </div>
      )}
      <RoleDialogHost api={api} editor={editor} view={view} actions={actions} />
    </SplitPage>
  );
}
