import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';

import { type SpecialistOption } from '../../../../shared/lib/specialistLabels.ts';

/** Radix `Select` has no empty value: this one stands for «nothing chosen». */
export const NONE = '__none';

/** The options with the current slug added (labelled by itself) when the file names an unknown one. */
export function withCurrent(options: SpecialistOption[], current: string): SpecialistOption[] {
  if (current === '' || options.some((option) => option.slug === current)) return options;
  return [...options, { slug: current, label: current }];
}

/** A choice of a specialist shown by name, stored by slug; an unknown current one stays in the list. */
export function SpecialistSelect({
  current,
  options,
  label,
  disabled,
  onChange,
}: {
  current: string;
  options: SpecialistOption[];
  label: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <Select
      value={current === '' ? NONE : current}
      disabled={disabled}
      onValueChange={(next) => onChange(next === NONE ? '' : next)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {withCurrent(options, current).map((option) => (
          <SelectItem key={option.slug} value={option.slug}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
