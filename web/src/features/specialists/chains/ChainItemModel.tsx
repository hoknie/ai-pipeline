import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { ModelField } from '../../../shared/ui/forms/picker/ModelField.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  levelOf,
  roleModelOptions,
  useProviderRegistry,
  useProvidersScope,
  type RoleModelOption,
} from '../../providers/index.ts';
import type { ChainRuntimeDraft } from './types.ts';

function roleLabel(option: RoleModelOption, options: RoleModelOption[]): string {
  const collision = options.some(
    (other) => other.role !== option.role && other.name === option.name,
  );
  return `${option.name}${collision ? ` (${option.role})` : ''} — ${option.model}`;
}

/** Edit source identity, never the resolved model or inherited execution options. */
export function ChainItemModel({
  api,
  index,
  item,
  disabled,
  onChange,
}: {
  api: Api;
  index: number;
  item: ChainRuntimeDraft;
  disabled: boolean;
  onChange: (item: ChainRuntimeDraft) => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const { view } = useProviderRegistry(api, null, levelOf(scope));
  const provider = view?.providers.find((candidate) => candidate.slug === item.provider);
  const options =
    provider && !item.invalidRuntime
      ? roleModelOptions(provider, view?.roles ?? [], item.runtime)
      : [];
  const selected = options.find((option) => option.role === item.model_role);
  const unresolved = Boolean(item.invalidModelRole || (view && item.model_role && !selected));
  const extra = options.map((option) => ({
    id: option.model,
    selectionKey: option.role,
    name: roleLabel(option, options),
    group: t('providers.chainRoles'),
  }));
  // Keep a removed role visible, not silently converted into a fixed model.
  if (item.model_role && !selected)
    extra.push({
      id: item.model_role,
      selectionKey: item.model_role,
      name: item.model_role,
      group: t('providers.chainRoles'),
    });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`chain-item-${index}-model`}>{t('chains.item.model')}</Label>
      <ModelField
        id={`chain-item-${index}-model`}
        runtime={item.runtime}
        label={t('chains.item.model')}
        value={item.model_role ? (selected?.model ?? item.model_role) : item.model}
        selectedKey={item.model_role || undefined}
        disabled={disabled}
        invalid={unresolved || Boolean(item.conflictingModel)}
        placeholder={t('chains.item.modelPlaceholder')}
        extra={extra}
        onSelect={(choice) =>
          onChange({
            ...item,
            model: choice.selectionKey ? '' : choice.id,
            model_role: choice.selectionKey ?? '',
            invalidModelRole: undefined,
            conflictingModel: undefined,
            chooseRole: false,
          })
        }
        onChange={(model) =>
          onChange({
            ...item,
            model,
            model_role: '',
            invalidModelRole: undefined,
            conflictingModel: undefined,
            chooseRole: false,
          })
        }
      />
      {unresolved ? (
        <p role="alert" className="text-xs text-destructive">
          {t('chains.item.unresolvedRole')}
        </p>
      ) : null}
    </div>
  );
}
