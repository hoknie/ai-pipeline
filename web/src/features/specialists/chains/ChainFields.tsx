import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { Card } from '../../../shared/ui/layout/card.tsx';
import type { ChainDraft } from './types.ts';

interface ChainFieldsProps {
  isNew: boolean;
  disabled: boolean;
  draft: ChainDraft;
  onChange: (updater: (cur: ChainDraft) => ChainDraft) => void;
}

function ChainMode({ disabled, draft, onChange }: Omit<ChainFieldsProps, 'isNew'>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="chain-mode">{t('chains.fields.mode')}</Label>
      <Select
        value={draft.mode}
        disabled={disabled}
        onValueChange={(mode) => onChange((cur) => ({ ...cur, mode: mode as ChainDraft['mode'] }))}
      >
        <SelectTrigger id="chain-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(['on_error', 'round_robin', 'random'] as const).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`chains.modes.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t('chains.help.mode')}</p>
    </div>
  );
}

export function ChainFields({ isNew, disabled, draft, onChange }: ChainFieldsProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <section aria-labelledby="chain-section-main" className="flex flex-col gap-3 p-4">
        <h3 id="chain-section-main" className="text-sm font-semibold">
          {t('specialists.sections.main')}
        </h3>
        {isNew ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chain-slug">{t('chains.fields.slug')}</Label>
            <Input
              id="chain-slug"
              value={draft.slug}
              disabled={disabled}
              placeholder="claude-to-opencode"
              onChange={(e) => onChange((cur) => ({ ...cur, slug: e.target.value }))}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chain-name">{t('chains.fields.name')}</Label>
          <Input
            id="chain-name"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => onChange((cur) => ({ ...cur, name: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">{t('chains.help.name')}</p>
        </div>
        <ChainMode disabled={disabled} draft={draft} onChange={onChange} />
        <div className="flex items-center gap-2">
          <Switch
            id="chain-enabled"
            checked={draft.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => onChange((cur) => ({ ...cur, enabled }))}
          />
          <Label htmlFor="chain-enabled" className="cursor-pointer">
            {draft.enabled ? t('chains.enabled') : t('chains.disabled')}
          </Label>
        </div>
      </section>
    </Card>
  );
}
