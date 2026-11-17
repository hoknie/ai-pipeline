import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import type { ChainRuntimeDraft } from './types.ts';

export interface ItemErrors {
  provider?: string;
  default?: string;
}

export function ItemProvider({
  index,
  item,
  disabled,
  tier,
  errors,
  onChange,
}: {
  index: number;
  item: ChainRuntimeDraft;
  disabled: boolean;
  tier: boolean;
  errors: ItemErrors;
  onChange: (patch: Partial<ChainRuntimeDraft>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`chain-item-${index}-provider`}>{t('chains.item.provider')}</Label>
      <Input
        id={`chain-item-${index}-provider`}
        value={item.provider}
        disabled={disabled}
        required={tier}
        aria-invalid={errors.provider ? true : undefined}
        placeholder={t('chains.item.providerPlaceholder')}
        onChange={(e) => onChange({ provider: e.target.value })}
      />
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
