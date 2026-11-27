import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import {
  levelOf,
  ProviderPicker,
  useProviderRegistry,
  useProvidersScope,
} from '../../providers/index.ts';
import type { ChainRuntimeDraft } from './types.ts';

export interface ItemErrors {
  provider?: string;
  default?: string;
}

export function ItemProvider({
  api,
  index,
  item,
  disabled,
  tier,
  errors,
  onChange,
}: {
  api: Api;
  index: number;
  item: ChainRuntimeDraft;
  disabled: boolean;
  tier: boolean;
  errors: ItemErrors;
  onChange: (patch: Partial<ChainRuntimeDraft>) => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const { view } = useProviderRegistry(api, null, levelOf(scope));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`chain-item-${index}-provider`}>{t('chains.item.provider')}</Label>
      <ProviderPicker
        id={`chain-item-${index}-provider`}
        label={t('chains.item.provider')}
        value={item.provider === '' ? null : item.provider}
        onChange={(provider) => {
          const changed = (provider ?? '') !== item.provider;
          onChange({
            provider: provider ?? '',
            ...(changed && (item.model_role || item.invalidModelRole)
              ? { model_role: '', model: '', invalidModelRole: undefined, chooseRole: true }
              : {}),
          });
        }}
        providers={view?.providers ?? []}
        {...(tier ? {} : { emptyLabel: t('chains.item.noProvider') })}
        placeholder={t('chains.item.chooseProvider')}
        repository={null}
        api={api}
        invalid={errors.provider !== undefined}
        disabled={disabled || view === null}
      />
      {item.chooseRole && !item.model_role && !item.model ? (
        <p role="alert" className="text-xs text-destructive">
          {t('chains.item.chooseRole')}
        </p>
      ) : null}
      {errors.provider ? (
        <p role="alert" className="text-xs text-destructive">
          {errors.provider}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {tier ? t('chains.item.providerRequired') : t('chains.item.providerHint')}
        </p>
      )}
      {tier ? (
        <div className="flex items-center gap-2">
          <Switch
            id={`chain-item-${index}-default`}
            checked={item.default}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ default: checked })}
          />
          <Label htmlFor={`chain-item-${index}-default`} className="cursor-pointer">
            {t('chains.item.default')}
          </Label>
        </div>
      ) : null}
      {errors.default ? (
        <p role="alert" className="text-xs text-destructive">
          {errors.default}
        </p>
      ) : null}
    </div>
  );
}
