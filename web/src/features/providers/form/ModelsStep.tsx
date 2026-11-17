import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { AccessModels, ProviderModelsView, RoleView } from '../../../shared/api/types.ts';
import { ModelPicker } from '../../../shared/ui/forms/ModelPicker.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { EFFORTS } from '../matrix/CellOptions.tsx';
import { levelOf, useProvidersScope } from '../page/scope.ts';
import { accessModelsOf, useProviderModels } from '../page/useProviderModels.ts';
import { hasOpencode } from './accessFields.ts';
import type { ModelDraft, ProviderDraft } from './draft.ts';

const BLANK: ModelDraft = { model: '', variant: '', effort: '' };

interface Catalog {
  view: ProviderModelsView | null;
  error: string | null;
  loading: boolean;
  ensure: () => void;
  refresh: () => void;
}

/** A combobox of models over the catalog of one access; without a catalog the model is typed. */
function CatalogPicker(props: {
  label: string;
  value: string;
  access: AccessModels | null;
  catalog: Catalog;
  onChange: (model: string) => void;
}) {
  const { label, value, access, catalog, onChange } = props;
  const { t } = useTranslation();
  return (
    <ModelPicker
      label={label}
      value={value}
      onChange={onChange}
      models={access?.models ?? []}
      error={catalog.error ?? access?.error ?? null}
      loading={catalog.loading}
      onRefresh={catalog.view ? catalog.refresh : undefined}
      onOpen={catalog.ensure}
      placeholder={t('providers.matrix.noModel')}
      emptyOption={t('providers.matrix.withoutModel')}
      manualHint={access === null || access.manual ? t('providers.matrix.manualHint') : undefined}
    />
  );
}

/** The options of OpenCode for the model of a role: the variant and the reasoning effort. */
function OptionFields({
  name,
  model,
  onChange,
}: {
  name: string;
  model: ModelDraft;
  onChange: (patch: Partial<ModelDraft>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input
        aria-label={t('providers.matrix.variantOf', { name })}
        placeholder={t('providers.matrix.variant')}
        value={model.variant}
        onChange={(event) => onChange({ variant: event.target.value })}
      />
      <select
        aria-label={t('providers.matrix.effortOf', { name })}
        className="h-9.5 rounded-md border border-input bg-card px-2 text-sm"
        value={model.effort}
        onChange={(event) => onChange({ effort: event.target.value })}
      >
        <option value="">{t('providers.matrix.effortDefault')}</option>
        {EFFORTS.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The models of the accesses of a role: each CLI access may name a model of its own. */
function AccessOverrides(props: {
  role: RoleView;
  draft: ProviderDraft;
  catalog: Catalog;
  onSet: (index: number, model: string) => void;
}) {
  const { role, draft, catalog, onSet } = props;
  const { t } = useTranslation();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {t('providers.form.overrides', { name: role.name })}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {draft.access.map((access, index) =>
          access.kind === 'cli' ? (
            <div key={index} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {index + 1}. {access.runtime}
              </span>
              <CatalogPicker
                label={`${role.name} · ${access.runtime}`}
                value={access.models[role.slug]?.model ?? ''}
                access={catalog.view?.access.find((item) => item.index === index) ?? null}
                catalog={catalog}
                onChange={(model) => onSet(index, model)}
              />
            </div>
          ) : null,
        )}
      </div>
    </details>
  );
}

/**
 * The step «Models»: a row per role with a model, the options of OpenCode and the models of single
 * accesses. A role without a model is fine. A provider that is not saved has no catalog: models are typed.
 */
export function ModelsStep(props: {
  api: Api;
  repository: string | null;
  /** Slug of the saved provider; null for a new one (no catalog yet). */
  slug: string | null;
  roles: RoleView[];
  draft: ProviderDraft;
  onChange: (patch: Partial<ProviderDraft>) => void;
}) {
  const { api, repository, slug, roles, draft, onChange } = props;
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const asked = useProviderModels(api, repository, slug ?? '', levelOf(scope));
  const catalog: Catalog = slug === null ? { ...asked, ensure: () => {}, view: null } : asked;
  const first = draft.access.findIndex((item) => item.enabled && item.kind === 'cli');
  const active = accessModelsOf(catalog.view, first);
  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('providers.empty.noRolesForm')}</p>;
  }
  const setModel = (role: string, patch: Partial<ModelDraft>) =>
    onChange({
      models: { ...draft.models, [role]: { ...(draft.models[role] ?? BLANK), ...patch } },
    });
  const setOwn = (index: number, role: string, model: string) =>
    onChange({
      access: draft.access.map((item, at) => {
        if (at !== index) return item;
        const own = { ...(item.models[role] ?? BLANK), model };
        return { ...item, models: { ...item.models, [role]: own } };
      }),
    });
  return (
    <ul className="flex flex-col gap-4">
      {roles.map((role) => {
        const current = draft.models[role.slug] ?? BLANK;
        return (
          <li key={role.slug} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{role.name}</span>
              <span className="text-xs text-muted-foreground">{role.slug}</span>
              {current.model === '' ? (
                <span className="text-xs text-status-warn">{t('providers.matrix.noModel')}</span>
              ) : null}
            </div>
            <CatalogPicker
              label={role.name}
              value={current.model}
              access={active}
              catalog={catalog}
              onChange={(model) => setModel(role.slug, { model })}
            />
            {hasOpencode(draft.access) ? (
              <OptionFields
                name={role.name}
                model={current}
                onChange={(patch) => setModel(role.slug, patch)}
              />
            ) : null}
            <AccessOverrides
              role={role}
              draft={draft}
              catalog={catalog}
              onSet={(index, model) => setOwn(index, role.slug, model)}
            />
          </li>
        );
      })}
    </ul>
  );
}
