import { Check, ChevronsUpDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.ts';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';

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
  const needle = query.trim().toLowerCase();
  const visible = options
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
            {selected.length > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {selected.length}
              </span>
            ) : null}
            <ChevronsUpDown className="size-3.5" />
          </span>
        </button>
      </PopoverTrigger>
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
                  <CommandItem
                    key={option.value}
                    value={`option:${option.value}`}
                    onSelect={() => toggle(option.value)}
                  >
                    <Check
                      className={cn(selected.includes(option.value) ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      {option.render ?? <span className="truncate">{option.label}</span>}
                      {option.hint ? (
                        <span className="text-xs break-all text-muted-foreground">
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {option.count}
                    </span>
                  </CommandItem>
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
