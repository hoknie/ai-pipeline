import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView, RoleView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { MatrixCellView } from '../matrix/MatrixCell.tsx';
import { useCellWrite } from '../matrix/useCellWrite.ts';
import { useProvidersScope } from '../page/scope.ts';
import { sourceOf } from '../page/sources.ts';

export interface RoleActions {
  ready: boolean;
  inLevel: boolean;
  canUp: boolean;
  canDown: boolean;
  onRename: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}

/** The models of a role at each provider, edited in place like the cells of the matrix. */
function RoleModels({
  api,
  repository,
  view,
  editor,
  role,
  readOnly,
}: {
  api: Api;
  repository: string | null;
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  role: RoleView;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const { write, errors, busy } = useCellWrite(api, repository, editor?.providers ?? []);
  const providers = view.providers.filter((provider) => provider.enabled);
  return (
    <section aria-label={t('providers.roles.models')} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('providers.roles.models')}</h3>
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('swarm.hints.needProvider')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => {
            const id = `${role.slug}:${provider.slug}`;
            const found = editor?.providers.find((item) => item.slug === provider.slug);
            return (
              <li
                key={provider.slug}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2"
              >
                <span className="min-w-32 font-medium">{provider.name}</span>
                <MatrixCellView
                  api={api}
                  repository={repository}
                  provider={provider}
                  role={role}
                  cell={view.matrix.find(
                    (item) => item.role === role.slug && item.provider === provider.slug,
                  )}
                  raw={sourceOf(found, scope)?.raw ?? null}
                  error={errors[id]}
                  busy={busy === id}
                  readOnly={readOnly}
                  onWrite={(change) => void write(id, provider.slug, change)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The details of a role: rename, order, remove, and its models by provider. */
export function RoleDetails(props: {
  api: Api;
  repository: string | null;
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  role: RoleView;
  actions: RoleActions;
  /** The mode «All projects»: no rename, order or removal, and the models are shown only. */
  readOnly?: boolean;
}) {
  const { role, actions } = props;
  const { t } = useTranslation();
  const name = role.name;
  const { ready } = actions;
  return (
    <div className="flex flex-col gap-4" aria-label={name}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-lg font-semibold">{name}</h2>
          <span className="truncate text-xs text-muted-foreground">
            {role.slug} · {t(`providers.level.${role.level}`)}
          </span>
        </div>
        {props.readOnly ? null : (
          <>
            <Button
              size="icon"
              variant="ghost"
              disabled={!ready}
              aria-label={t('providers.roles.renameRole', { name })}
              onClick={actions.onRename}
            >
              <Pencil />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              disabled={!ready || !actions.canUp}
              aria-label={t('providers.roles.up', { name })}
              onClick={() => actions.onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              disabled={!ready || !actions.canDown}
              aria-label={t('providers.roles.down', { name })}
              onClick={() => actions.onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              disabled={!ready || !actions.inLevel}
              aria-label={t('providers.roles.removeRole', { name })}
              onClick={actions.onRemove}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
      <RoleModels
        api={props.api}
        repository={props.repository}
        view={props.view}
        editor={props.editor}
        role={role}
        readOnly={props.readOnly === true}
      />
    </div>
  );
}
