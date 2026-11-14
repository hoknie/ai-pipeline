import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/ui/forms/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../../shared/ui/forms/toggle-group.tsx';
import type { VariantDraft } from './variantDraft.ts';

export const DEFAULT_ITEM = 'default';

/** The title of a variant in the switcher: its name, else its id. */
export function variantTitle(variant: VariantDraft): string {
  return variant.name.trim() || variant.id;
}

/** `default`, the variants of the draft in order and the button that adds one. */
export function VariantSwitcher({
  variants,
  selected,
  disabled,
  onSelect,
  onAdd,
}: {
  variants: VariantDraft[];
  /** The key of the selected variant; null: `default`. */
  selected: number | null;
  /** Adding is a change of the draft; selecting is not. */
  disabled: boolean;
  onSelect: (key: number | null) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        className="h-auto flex-wrap"
        aria-label={t('variants.switcher')}
        value={selected === null ? DEFAULT_ITEM : String(selected)}
        onValueChange={(value) => {
          if (value) onSelect(value === DEFAULT_ITEM ? null : Number(value));
        }}
      >
        <ToggleGroupItem value={DEFAULT_ITEM}>{t('variants.default')}</ToggleGroupItem>
        {variants.map((variant) => (
          <ToggleGroupItem key={variant.key} value={String(variant.key)} title={variant.id}>
            {variantTitle(variant)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button variant="outline" size="sm" disabled={disabled} onClick={onAdd}>
        <Plus aria-hidden />
        {t('variants.add')}
      </Button>
    </div>
  );
}
