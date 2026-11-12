import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReasoningEffort } from '../../../shared/api/types.ts';
import { ModelField } from '../../../shared/ui/forms/picker/ModelField.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
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
import type { ChainRuntimeDraft, SpecialistRuntimeName } from './types.ts';

const RUNTIMES: readonly SpecialistRuntimeName[] = ['claude', 'opencode', 'agy'];
const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[];
const INHERIT = '__inherit';

export interface ChainRuntimeItemProps {
  index: number;
  item: ChainRuntimeDraft;
  total: number;
  disabled: boolean;
  onChange: (item: ChainRuntimeDraft) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function ItemHeader({
  index,
  item,
  total,
  disabled,
  onEnabled,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  item: ChainRuntimeDraft;
  total: number;
  disabled: boolean;
  onEnabled: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Switch
          id={`chain-item-${index}-enabled`}
          checked={item.enabled}
          disabled={disabled}
          onCheckedChange={onEnabled}
        />
        <Label htmlFor={`chain-item-${index}-enabled`} className="cursor-pointer">
          {item.enabled ? t('chains.item.enabled') : t('chains.item.disabled')}
        </Label>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || index === 0}
          onClick={onMoveUp}
          aria-label={t('chains.item.moveUp')}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || index === total - 1}
          onClick={onMoveDown}
          aria-label={t('chains.item.moveDown')}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || total <= 1}
          onClick={onRemove}
          aria-label={t('chains.item.remove')}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function ItemFields({
  index,
  item,
  disabled,
  onRuntime,
  onModel,
}: {
  index: number;
  item: ChainRuntimeDraft;
  disabled: boolean;
  onRuntime: (val: SpecialistRuntimeName) => void;
  onModel: (val: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`chain-item-${index}-runtime`}>{t('chains.item.runtime')}</Label>
        <Select value={item.runtime} disabled={disabled} onValueChange={onRuntime}>
          <SelectTrigger id={`chain-item-${index}-runtime`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RUNTIMES.map((rt) => (
              <SelectItem key={rt} value={rt}>
                {rt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`chain-item-${index}-model`}>{t('chains.item.model')}</Label>
        <ModelField
          id={`chain-item-${index}-model`}
          runtime={item.runtime}
          label={t('chains.item.model')}
          value={item.model}
          disabled={disabled}
          placeholder={t('chains.item.modelPlaceholder')}
          onChange={onModel}
        />
      </div>
    </div>
  );
}

function ItemOpencodeFields({
  index,
  item,
  disabled,
  onVariant,
  onEffort,
}: {
  index: number;
  item: ChainRuntimeDraft;
  disabled: boolean;
  onVariant: (val: string) => void;
  onEffort: (val: ReasoningEffort | '') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`chain-item-${index}-variant`}>{t('chains.item.variant')}</Label>
        <Input
          id={`chain-item-${index}-variant`}
          value={item.variant}
          disabled={disabled}
          placeholder={t('chains.item.variantPlaceholder')}
          onChange={(e) => onVariant(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`chain-item-${index}-effort`}>{t('chains.item.reasoningEffort')}</Label>
        <Select
          value={item.reasoning_effort === '' ? INHERIT : item.reasoning_effort}
          disabled={disabled}
          onValueChange={(val) => onEffort(val === INHERIT ? '' : (val as ReasoningEffort))}
        >
          <SelectTrigger id={`chain-item-${index}-effort`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>{t('specialists.byDefault')}</SelectItem>
            {REASONING_EFFORTS.map((effort) => (
              <SelectItem key={effort} value={effort}>
                {effort}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function ChainRuntimeItem({
  index,
  item,
  total,
  disabled,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: ChainRuntimeItemProps) {
  const setField = <K extends keyof ChainRuntimeDraft>(key: K, val: ChainRuntimeDraft[K]) =>
    onChange({ ...item, [key]: val });

  return (
    <Card className={`flex flex-col gap-3 p-4 ${item.enabled ? '' : 'bg-muted/40 opacity-70'}`}>
      <ItemHeader
        index={index}
        item={item}
        total={total}
        disabled={disabled}
        onEnabled={(checked) => setField('enabled', checked)}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onRemove={onRemove}
      />
      <ItemFields
        index={index}
        item={item}
        disabled={disabled}
        onRuntime={(val) => setField('runtime', val)}
        onModel={(val) => setField('model', val)}
      />
      {item.runtime === 'opencode' ? (
        <ItemOpencodeFields
          index={index}
          item={item}
          disabled={disabled}
          onVariant={(val) => setField('variant', val)}
          onEffort={(val) => setField('reasoning_effort', val)}
        />
      ) : null}
    </Card>
  );
}
