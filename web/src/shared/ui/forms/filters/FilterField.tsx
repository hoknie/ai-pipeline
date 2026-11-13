import { useId, useState } from 'react';

import { Popover, PopoverContent } from '../../overlays/popover.tsx';
import { AddTrigger, PickerChips } from '../picker/pickerParts.tsx';
import { FilterList, type FilterOption } from './FilterList.tsx';

export type { FilterOption };

/**
 * A multiselect filter: a label above a frame with chips of the chosen values and «Add», which
 * opens a searchable list. Choosing does not close the list.
 */
export function FilterField({
  id,
  label,
  options,
  selected,
  onChange,
  clearLabel,
  disabled = false,
}: {
  id?: string;
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  clearLabel: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const display = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <div className="flex min-h-9.5 min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5">
          <PickerChips
            inherited={[]}
            values={selected}
            display={display}
            mark={undefined}
            disabled={disabled}
            onRemove={(value) => onChange(selected.filter((v) => v !== value))}
          />
          <AddTrigger id={id} label={label} open={open} listId={listId} disabled={disabled} />
        </div>
        <PopoverContent className="p-0">
          <FilterList
            label={label}
            listId={listId}
            options={options}
            selected={selected}
            query={query}
            onQuery={setQuery}
            onChange={onChange}
            clearLabel={clearLabel}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
