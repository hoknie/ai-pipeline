import { GitFork } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { MatrixCell as Cell, ProviderView, RoleView } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { ModelPicker } from '../../../shared/ui/forms/ModelPicker.tsx';
import type { Raw } from '../page/sources.ts';
import { levelOf, useProvidersScope } from '../page/scope.ts';
import { accessModelsOf, useProviderModels } from '../page/useProviderModels.ts';
import { CellOptions } from './CellOptions.tsx';
import { clearRole, roleModelOf, setRoleModel, type ModelOptions } from './edit.ts';

/** The accesses of a provider that give the role a model of their own: «claude: glm-5.3». */
export function overrideHint(provider: ProviderView, role: string): string {
  return provider.access
    .flatMap((access) => {
      const own = access.models[role];
      return own ? [`${access.runtime ?? 'api'}: ${own.model}`] : [];
    })
    .join('\n');
}

export interface CellProps {
  api: Api;
  repository: string | null;
  provider: ProviderView;
  role: RoleView;
  cell: Cell | undefined;
  /** The file of the provider; null while the editor view is not loaded. */
  raw: Raw | null;
  error: string | undefined;
  busy: boolean;
  onWrite: (change: (raw: Raw) => Raw) => void;
  /** The mode «All projects»: the model is shown, not edited. */
  readOnly?: boolean;
}

/** The model of a role at a provider as text. */
function ReadOnlyCell({ cell, role, provider }: Pick<CellProps, 'cell' | 'role' | 'provider'>) {
  const { t } = useTranslation();
  const model = cell?.model?.model ?? '';
  return (
    <span
      data-empty={model === '' ? 'true' : undefined}
      aria-label={`${role.name} × ${provider.name}`}
      className="min-w-40 text-sm text-muted-foreground"
    >
      {model === '' ? t('providers.matrix.noModel') : model}
    </span>
  );
}

/** One cell of the matrix: the model of a role at a provider, edited in place. */
export function MatrixCellView(props: CellProps) {
  return props.readOnly ? <ReadOnlyCell {...props} /> : <EditableCell {...props} />;
}

function EditableCell(props: CellProps) {
  const { api, repository, provider, role, cell, raw, error, busy, onWrite } = props;
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const catalog = useProviderModels(api, repository, provider.slug, levelOf(scope));
  const access = accessModelsOf(catalog.view, provider.active);
  const label = `${role.name} × ${provider.name}`;
  const model = cell?.model?.model ?? '';
  const hint = overrideHint(provider, role.slug);
  const current = raw ? roleModelOf(raw, role.slug) : null;
  const opencode = provider.access.some((item) => item.runtime === 'opencode');
  const options = { variant: current?.variant ?? '', effort: current?.effort ?? '' };
  const disabled = raw === null || busy;
  const change = (next: string) =>
    onWrite((file) =>
      next === ''
        ? clearRole(file, role.slug)
        : setRoleModel(file, role.slug, next, opencode ? options : {}),
    );
  return (
    <div
      data-empty={model === '' ? 'true' : undefined}
      className={cn(
        'flex min-w-40 flex-col gap-1 rounded-md',
        model === '' && 'ring-1 ring-status-warn bg-status-warn-bg/40',
      )}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <ModelPicker
            label={label}
            value={model}
            onChange={change}
            models={access?.models ?? []}
            error={catalog.error ?? access?.error ?? null}
            loading={catalog.loading || busy}
            onRefresh={catalog.refresh}
            onOpen={catalog.ensure}
            placeholder={t('providers.matrix.noModel')}
            emptyOption={t('providers.matrix.withoutModel')}
            manualHint={access?.manual ? t('providers.matrix.manualHint') : undefined}
            disabled={disabled}
          />
        </div>
        {hint ? (
          <span
            role="img"
            title={hint}
            aria-label={t('providers.matrix.overrides', { hint })}
            className="text-muted-foreground"
          >
            <GitFork className="size-4" />
          </span>
        ) : null}
        {opencode ? (
          <CellOptions
            label={label}
            options={options}
            disabled={disabled || model === ''}
            onApply={(next: ModelOptions) =>
              onWrite((file) => setRoleModel(file, role.slug, model, next))
            }
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
