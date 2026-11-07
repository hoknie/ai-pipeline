import { Check, ChevronsUpDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/browser/cn.ts';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../overlays/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../overlays/popover.tsx';

export interface FilterOption {
  value: string;
  /** Text searched and shown unless `render` is given. */
  label: string;
  /** A second line under the label, such as a path; searched too. */
  hint?: string;
  /** How many items the choice would show; shown at the right. */
  count: number;
  render?: ReactNode;
}

/** The options that match the query, the chosen ones first. */
function visibleOptions(
  options: FilterOption[],
  selected: string[],
  query: string,
): FilterOption[] {
  const needle = query.trim().toLowerCase();
  return options
    .filter(
      (option) =>
        needle === '' ||
        option.label.toLowerCase().includes(needle) ||
        (option.hint ?? '').toLowerCase().includes(needle),
    )
    .map((option, index) => ({ option, index }))
    .sort(
      (left, right) =>
        Number(selected.includes(right.option.value)) -
          Number(selected.includes(left.option.value)) || left.index - right.index,
    )
    .map(({ option }) => option);
}

function FilterTrigger({
  id,
  label,
  open,
  listId,
  count,
}: {
  id?: string;
  label: string;
  open: boolean;
  listId: string;
  count: number;
}) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm hover:bg-accent"
      >
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {count > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {count}
            </span>
          ) : null}
          <ChevronsUpDown className="size-3.5" />
        </span>
      </button>
    </PopoverTrigger>
  );
}

function OptionRow({
  option,
  checked,
  onToggle,
}: {
  option: FilterOption;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <CommandItem value={`option:${option.value}`} onSelect={onToggle}>
      <Check className={cn(checked ? 'opacity-100' : 'opacity-0')} />
      <span className="flex min-w-0 flex-1 flex-col">
        {option.render ?? <span className="truncate">{option.label}</span>}
        {option.hint ? (
          <span className="text-xs break-all text-muted-foreground">{option.hint}</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
    </CommandItem>
  );
}

/**
 * A multiselect for a filter: a button with the name and the number of chosen values, and a
 * popover with a search, the options (chosen ones first, with counters) and «Clear». Choosing
 * does not close the list; the chosen values are not shown anywhere else.
 */
export function FilterSelect({
  id,
  label,
  options,
  selected,
  onChange,
  clearLabel,
}: {
  id?: string;
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  clearLabel: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = visibleOptions(options, selected, query);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <FilterTrigger id={id} label={label} open={open} listId={listId} count={selected.length} />
      <PopoverContent className="p-0">
        <Command shouldFilter={false} label={t('picker.search', { label })}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('picker.searchOnly')}
          />
          <CommandList id={listId}>
            <CommandEmpty>{t('picker.nothing')}</CommandEmpty>
            {visible.length > 0 ? (
              <CommandGroup>
                {visible.map((option) => (
                  <OptionRow
                    key={option.value}
                    option={option}
                    checked={selected.includes(option.value)}
                    onToggle={() => toggle(option.value)}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {selected.length > 0 ? (
              <CommandGroup className="border-t">
                <CommandItem value="clear" onSelect={() => onChange([])}>
                  {clearLabel}
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
