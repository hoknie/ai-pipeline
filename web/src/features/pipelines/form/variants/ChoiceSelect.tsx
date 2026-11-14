import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';

/** Radix `Select` has no empty value: this one stands for «as in the pipeline». */
const INHERIT = '__inherit';

/** A choice whose first item is «as in the pipeline», with the value of the pipeline as a hint. */
export function ChoiceSelect({
  id,
  label,
  value,
  options,
  hint,
  disabled,
  invalid,
  onChange,
}: {
  id?: string;
  label: string;
  /** `undefined`: as in the pipeline. */
  value: string | undefined;
  options: { value: string; label: string }[];
  /** The value the pipeline has; empty when unknown. */
  hint: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const known = value === undefined || options.some((option) => option.value === value);
  return (
    <Select
      value={value ?? INHERIT}
      disabled={disabled}
      onValueChange={(next) => onChange(next === INHERIT ? undefined : next)}
    >
      <SelectTrigger {...(id ? { id } : {})} aria-label={label} aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>
          {hint ? t('variants.asInPipelineHint', { value: hint }) : t('variants.asInPipeline')}
        </SelectItem>
        {known ? null : <SelectItem value={value}>{value}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
