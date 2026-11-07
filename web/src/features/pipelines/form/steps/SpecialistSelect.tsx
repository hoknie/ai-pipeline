import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';

/** Radix `Select` has no empty value: this one stands for «nothing chosen». */
export const NONE = '__none';

/** A choice of a specialist by slug; the current one stays in the list even if unknown. */
export function SpecialistSelect({
  current,
  slugs,
  label,
  disabled,
  onChange,
}: {
  current: string;
  slugs: string[];
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
        {[...new Set([...slugs, ...(current && !slugs.includes(current) ? [current] : [])])].map(
          (slug) => (
            <SelectItem key={slug} value={slug}>
              {slug}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}
