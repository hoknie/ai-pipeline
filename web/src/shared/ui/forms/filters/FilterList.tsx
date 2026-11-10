import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/browser/cn.ts';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../overlays/command.tsx';

export interface FilterOption {
  value: string;
  /** Text searched and shown unless `render` is given. */
  label: string;
  /** A second line under the label, such as a path; searched too. */
  hint?: string;
  /** How many items the choice would show; shown at the right when given. */
  count?: number;
  /** Heading of the section of the list the option belongs to. */
  group?: string;
  render?: ReactNode;
}

/** The options that match the query, the chosen ones first. */
export function visibleOptions(
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
      {option.count === undefined ? null : (
        <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
      )}
    </CommandItem>
  );
}

/** Groups in the order of their first option; options without a group form one unnamed group. */
function grouped(visible: FilterOption[]): [string | undefined, FilterOption[]][] {
  const groups = new Map<string | undefined, FilterOption[]>();
  for (const option of visible) {
    groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
  }
  return [...groups];
}

/**
 * The list of a filter: a search, the options (the chosen ones first, with a tick, a counter and
 * a group heading when given) and «Clear». Choosing does not close the list.
 */
export function FilterList({
  label,
  listId,
  options,
  selected,
  query,
  onQuery,
  onChange,
  clearLabel,
}: {
  label: string;
  listId: string;
  options: FilterOption[];
  selected: string[];
  query: string;
  onQuery: (query: string) => void;
  onChange: (values: string[]) => void;
  clearLabel: string;
}) {
  const { t } = useTranslation();
  const visible = visibleOptions(options, selected, query);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  return (
    <Command shouldFilter={false} label={t('picker.search', { label })}>
      <CommandInput value={query} onValueChange={onQuery} placeholder={t('picker.searchOnly')} />
      <CommandList id={listId}>
        <CommandEmpty>{t('picker.nothing')}</CommandEmpty>
        {grouped(visible).map(([group, list]) => (
          <CommandGroup key={group ?? ''} heading={group || undefined}>
            {list.map((option) => (
              <OptionRow
                key={option.value}
                option={option}
                checked={selected.includes(option.value)}
                onToggle={() => toggle(option.value)}
              />
            ))}
          </CommandGroup>
        ))}
        {selected.length > 0 ? (
          <CommandGroup className="border-t">
            <CommandItem value="clear" onSelect={() => onChange([])}>
              {clearLabel}
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
}
