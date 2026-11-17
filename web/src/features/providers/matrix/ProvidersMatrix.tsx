import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { useProvidersScope } from '../page/scope.ts';
import { sourceOf } from '../page/sources.ts';
import { MatrixCellView } from './MatrixCell.tsx';
import { MatrixCards, MatrixTable } from './MatrixLayouts.tsx';
import { useCellWrite } from './useCellWrite.ts';

function NoRoles({ onRoles }: { onRoles: (event: MouseEvent) => void }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('providers.matrix.label')} className="rounded-lg border p-4 text-sm">
      <p className="text-muted-foreground">{t('providers.empty.noRolesMatrix')}</p>
      <a className="text-primary underline" href="#providers/roles" onClick={onRoles}>
        {t('providers.empty.addRoles')}
      </a>
    </section>
  );
}

/** The matrix «role × provider»: a row per role, a column per enabled provider. */
export function ProvidersMatrix({
  api,
  repository,
  view,
  editor,
  narrow,
  readOnly = false,
  onRoles,
}: {
  api: Api;
  repository: string | null;
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  narrow: boolean;
  /** The mode «All projects»: the matrix only shows the models. */
  readOnly?: boolean;
  /** Opens the tab «Roles» of the window (the link of the empty matrix). */
  onRoles?: () => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const [showOff, setShowOff] = useState(false);
  const { write, errors, busy } = useCellWrite(api, repository, editor?.providers ?? []);
  if (view.roles.length === 0) {
    return (
      <NoRoles
        onRoles={(event) => {
          if (!onRoles) return;
          event.preventDefault();
          onRoles();
        }}
      />
    );
  }
  const providers = view.providers.filter((provider) => showOff || provider.enabled);
  const cell = (provider: (typeof providers)[number], role: (typeof view.roles)[number]) => {
    const id = `${role.slug}:${provider.slug}`;
    const found = editor?.providers.find((item) => item.slug === provider.slug);
    return (
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
    );
  };
  const Layout = narrow ? MatrixCards : MatrixTable;
  return (
    <section aria-label={t('providers.matrix.label')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('providers.matrix.title')}</h2>
        <div className="flex items-center gap-2">
          <Switch id="matrix-off" checked={showOff} onCheckedChange={setShowOff} />
          <Label htmlFor="matrix-off" className="cursor-pointer">
            {t('providers.matrix.showDisabled')}
          </Label>
        </div>
      </div>
      <Layout roles={view.roles} providers={providers} cell={cell} />
    </section>
  );
}
