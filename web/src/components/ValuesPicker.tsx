import { Check, Plus, X } from 'lucide-react';
import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.ts';
import { Badge } from '../ui/badge.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';

export type OptionSource = 'builtin' | 'project' | 'global';

export interface PickerOption {
  name: string;
  source: OptionSource;
  description?: string;
}

const GROUPS: OptionSource[] = ['builtin', 'project', 'global'];
const CREATE = '__create';

/** Adds the values that are not in the list yet, keeping the order; nothing is added twice. */
export function withValues(current: string[], added: string[]): string[] {
  const next = [...current];
  for (const raw of added) {
    const value = raw.trim();
    if (value !== '' && !next.includes(value)) next.push(value);
  }
  return next;
}

/**
 * A multiselect: chips for the chosen values and a popover with a searchable list. A value that
 * is not in `options` can be typed in when `creatable`; `inherited` chips are grey and cannot be removed.
 */
export function ValuesPicker({
  id,
  label,
  values,
  onChange,
  options = [],
  inherited = [],
  mark,
  display,
  headings,
  creatable = true,
  disabled = false,
  invalid = false,
  contentClassName,
}: {
  id?: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options?: PickerOption[];
  /** Values taken from defaults: shown as grey chips, not removable. */
  inherited?: string[];
  /** A note shown next to a value, such as «not found»; null for none. */
  mark?: (value: string) => string | null;
  /** The text of a chosen value in its chip and in the remove button; default: the value itself. */
  display?: (value: string) => string;
  /** Group headings instead of the names of the sources. */
  headings?: Partial<Record<OptionSource, string>>;
  creatable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Extra classes of the popover with the list. */
  contentClassName?: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const typed = query.trim();
  const needle = typed.toLowerCase();
  const visible = options.filter(
    (option) =>
      needle === '' ||
      option.name.toLowerCase().includes(needle) ||
      (option.description ?? '').toLowerCase().includes(needle),
  );
  const canCreate = creatable && typed !== '' && !options.some((option) => option.name === typed);

  const add = (added: string[]) => {
    const next = withValues(values, added);
    if (next.length !== values.length) onChange(next);
    setQuery('');
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!creatable || !/[\r\n]/.test(text)) return;
    event.preventDefault();
    add(text.split(/\r?\n/));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && query === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <div
        className="flex min-h-8 min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5 aria-invalid:border-destructive"
        aria-invalid={invalid}
      >
        {inherited.map((value) => (
          <Badge key={`inherited:${value}`} variant="mute" data-inherited>
            {value}
            <span className="font-normal">{t('picker.fromDefaults')}</span>
          </Badge>
        ))}
        {values.map((value) => {
          const note = mark?.(value) ?? null;
          const text = display?.(value) ?? value;
          return (
            <Badge key={value} variant="outline" className="min-w-0 max-w-full gap-1.5 pr-1">
              <span className="min-w-0 truncate" title={text}>
                {text}
              </span>
              {note ? <span className="font-normal text-status-warn">{note}</span> : null}
              <button
                type="button"
                aria-label={t('picker.remove', { value: text })}
                disabled={disabled}
                className="shrink-0 rounded-full p-0.5 hover:bg-accent disabled:opacity-50"
                onClick={() => onChange(values.filter((candidate) => candidate !== value))}
              >
                <X />
              </button>
            </Badge>
          );
        })}
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listId : undefined}
            disabled={disabled}
            className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <Plus className="size-3" />
            {t('picker.add')}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className={cn('p-0', contentClassName)}>
        <Command shouldFilter={false} label={t('picker.search', { label })}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder={creatable ? t('picker.searchOrType') : t('picker.searchOnly')}
          />
          <CommandList id={listId}>
            {visible.length === 0 && !canCreate ? (
              <CommandEmpty>
                {options.length === 0 ? t('picker.typeValue') : t('picker.nothing')}
              </CommandEmpty>
            ) : null}
            {GROUPS.map((source) => {
              const group = visible.filter((option) => option.source === source);
              if (group.length === 0) return null;
              return (
                <CommandGroup
                  key={source}
                  heading={headings?.[source] ?? t(`picker.groups.${source}`)}
                >
                  {group.map((option) => {
                    const chosen = values.includes(option.name);
                    const note = mark?.(option.name) ?? null;
                    return (
                      <CommandItem
                        key={`${source}:${option.name}`}
                        value={`${source}:${option.name}`}
                        onSelect={() => add([option.name])}
                      >
                        <Check className={chosen ? 'opacity-100' : 'opacity-0'} />
                        <span className="flex min-w-0 flex-col">
                          <span
                            className="line-clamp-3 whitespace-normal break-words"
                            title={display?.(option.name) ?? option.name}
                          >
                            {display?.(option.name) ?? option.name}
                            {note ? (
                              <span className="ml-2 text-xs text-status-warn">{note}</span>
                            ) : null}
                          </span>
                          {option.description && !display ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
            {canCreate ? (
              <CommandGroup>
                <CommandItem value={`${CREATE}:${typed}`} onSelect={() => add([typed])}>
                  <Plus />
                  {t('picker.create', { value: typed })}
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
