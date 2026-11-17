import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/overlays/popover.tsx';
import type { ModelOptions } from './edit.ts';

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const DEFAULT = '__default';

/** The options of a model (`variant`, `reasoning_effort`) of a cell; only OpenCode takes them. */
export function CellOptions({
  label,
  options,
  disabled,
  onApply,
}: {
  label: string;
  options: Required<ModelOptions>;
  disabled: boolean;
  onApply: (options: ModelOptions) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState(options.variant);
  const [effort, setEffort] = useState(options.effort);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setVariant(options.variant);
          setEffort(options.effort);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t('providers.matrix.options', { label })}
        >
          <Ellipsis />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-72 flex-col gap-3 p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${label}`}>{t('providers.matrix.variant')}</Label>
          <Input
            id={`variant-${label}`}
            value={variant}
            onChange={(event) => setVariant(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id={`effort-${label}`}>{t('providers.matrix.effort')}</Label>
          <Select
            value={effort === '' ? DEFAULT : effort}
            onValueChange={(next) => setEffort(next === DEFAULT ? '' : next)}
          >
            <SelectTrigger aria-labelledby={`effort-${label}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t('providers.matrix.effortDefault')}</SelectItem>
              {EFFORTS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onApply({ variant: variant.trim(), effort });
            setOpen(false);
          }}
        >
          {t('providers.matrix.apply')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
