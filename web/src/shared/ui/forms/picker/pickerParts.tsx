import { Check, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../feedback/badge.tsx';
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from '../../overlays/command.tsx';
import { PopoverTrigger } from '../../overlays/popover.tsx';

export type OptionSource = 'builtin' | 'project' | 'global';

export interface PickerOption {
  name: string;
  source: OptionSource;
  description?: string;
}

export const GROUPS: OptionSource[] = ['builtin', 'project', 'global'];
export const CREATE = '__create';

function ValueChip({
  text,
  note,
  disabled,
  onRemove,
}: {
  text: string;
  note: string | null;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="min-w-0 max-w-full gap-1.5 pr-1">
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
      {note ? <span className="font-normal text-status-warn">{note}</span> : null}
      <button
        type="button"
        aria-label={t('picker.remove', { value: text })}
        disabled={disabled}
        className="shrink-0 rounded-full p-0.5 hover:bg-accent disabled:opacity-50"
        onClick={onRemove}
      >
        <X />
      </button>
    </Badge>
  );
}

function OptionGroup({
  source,
  heading,
  options,
  values,
  mark,
  display,
  onAdd,
}: {
  source: OptionSource;
  heading: string | undefined;
  options: PickerOption[];
  values: string[];
  mark: ((value: string) => string | null) | undefined;
  display: ((value: string) => string) | undefined;
  onAdd: (name: string) => void;
}) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <CommandGroup heading={(heading ?? t(`picker.groups.${source}`)) || undefined}>
      {options.map((option) => {
        const note = mark?.(option.name) ?? null;
        const text = display?.(option.name) ?? option.name;
        return (
          <CommandItem
            key={`${source}:${option.name}`}
            value={`${source}:${option.name}`}
            onSelect={() => onAdd(option.name)}
          >
            <Check className={values.includes(option.name) ? 'opacity-100' : 'opacity-0'} />
            <span className="flex min-w-0 flex-col">
              <span className="line-clamp-3 whitespace-normal break-words" title={text}>
                {text}
                {note ? <span className="ml-2 text-xs text-status-warn">{note}</span> : null}
              </span>
              {option.description && !display ? (
                <span className="truncate text-xs text-muted-foreground">{option.description}</span>
              ) : null}
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

/** The options whose name or description contains the typed text. */
export function matchingOptions(options: PickerOption[], typed: string): PickerOption[] {
  const needle = typed.toLowerCase();
  return options.filter(
    (option) =>
      needle === '' ||
      option.name.toLowerCase().includes(needle) ||
      (option.description ?? '').toLowerCase().includes(needle),
  );
}

export function PickerChips({
  inherited,
  values,
  display,
  mark,
  disabled,
  onRemove,
}: {
  inherited: string[];
  values: string[];
  display: ((value: string) => string) | undefined;
  mark: ((value: string) => string | null) | undefined;
  disabled: boolean;
  onRemove: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {inherited.map((value) => (
        <Badge key={`inherited:${value}`} variant="mute" data-inherited>
          {value}
          <span className="font-normal">{t('picker.fromDefaults')}</span>
        </Badge>
      ))}
      {values.map((value) => (
        <ValueChip
          key={value}
          text={display?.(value) ?? value}
          note={mark?.(value) ?? null}
          disabled={disabled}
          onRemove={() => onRemove(value)}
        />
      ))}
    </>
  );
}

export function AddTrigger({
  id,
  label,
  open,
  listId,
  disabled,
}: {
  id?: string;
  label: string;
  open: boolean;
  listId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
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
        disabled={disabled}
        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        <Plus className="size-3" />
        {t('picker.add')}
      </button>
    </PopoverTrigger>
  );
}

export function PickerList({
  listId,
  options,
  visible,
  typed,
  canCreate,
  values,
  headings,
  mark,
  display,
  onAdd,
}: {
  listId: string;
  options: PickerOption[];
  visible: PickerOption[];
  typed: string;
  canCreate: boolean;
  values: string[];
  headings: Partial<Record<OptionSource, string>> | undefined;
  mark: ((value: string) => string | null) | undefined;
  display: ((value: string) => string) | undefined;
  onAdd: (added: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <CommandList id={listId}>
      {visible.length === 0 && !canCreate ? (
        <CommandEmpty>
          {options.length === 0 ? t('picker.typeValue') : t('picker.nothing')}
        </CommandEmpty>
      ) : null}
      {GROUPS.map((source) => (
        <OptionGroup
          key={source}
          source={source}
          heading={headings?.[source]}
          options={visible.filter((option) => option.source === source)}
          values={values}
          mark={mark}
          display={display}
          onAdd={(name) => onAdd([name])}
        />
      ))}
      {canCreate ? (
        <CommandGroup>
          <CommandItem value={`${CREATE}:${typed}`} onSelect={() => onAdd([typed])}>
            <Plus />
            {t('picker.create', { value: typed })}
          </CommandItem>
        </CommandGroup>
      ) : null}
    </CommandList>
  );
}

/** Adds the values that are not in the list yet, keeping the order; nothing is added twice. */
export function withValues(current: string[], added: string[]): string[] {
  const next = [...current];
  for (const raw of added) {
    const value = raw.trim();
    if (value !== '' && !next.includes(value)) next.push(value);
  }
  return next;
}
