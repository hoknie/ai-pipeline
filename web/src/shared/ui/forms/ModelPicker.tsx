import { Check, ChevronsUpDown, Plus, RefreshCw } from 'lucide-react';
import { type ComponentProps, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelEntry } from '../../api/types.ts';
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
import { groupModels, matchingModels } from './picker/modelParts.ts';

const DEFAULT = '__default';
const CREATE = '__create';

export interface ModelPickerProps {
  id?: string;
  label: string;
  /** The chosen model id; empty is «by default». */
  value: string;
  onChange: (value: string) => void;
  models: ModelEntry[];
  /** Why the runtime could not list its models. */
  error?: string | null;
  loading?: boolean;
  /** Asks the runtimes again; without it there is no button. */
  onRefresh?: () => void;
  /** What an empty value falls back to, shown on the button. */
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}

function ModelOption({
  model,
  chosen,
  onSelect,
}: {
  model: ModelEntry;
  chosen: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={`model:${model.id}`} onSelect={onSelect}>
      <Check className={chosen ? 'opacity-100' : 'opacity-0'} />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="break-all">{model.name}</span>
        {model.name !== model.id ? (
          <span className="break-all text-xs text-muted-foreground">{model.id}</span>
        ) : null}
      </span>
    </CommandItem>
  );
}

function ModelFooter({
  error,
  loading,
  onRefresh,
}: {
  error?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5 text-xs">
      <span
        role={error ? 'alert' : 'status'}
        className={cn('min-w-0 break-words', error ? 'text-status-warn' : 'text-muted-foreground')}
      >
        {error ?? (loading ? t('models.loading') : '')}
      </span>
      {onRefresh ? (
        <button
          type="button"
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-accent disabled:opacity-50"
          onClick={onRefresh}
        >
          <RefreshCw className="size-3" />
          {t('models.refresh')}
        </button>
      ) : null}
    </div>
  );
}

function ModelTrigger(
  props: ComponentProps<'button'> & {
    id?: string;
    label: string;
    value: string;
    known?: ModelEntry;
    notInList: boolean;
    open: boolean;
    placeholder?: string;
    disabled: boolean;
    invalid: boolean;
  },
) {
  const { label, value, known, notInList, open, placeholder, invalid, ...rest } = props;
  const { t } = useTranslation();
  return (
    <button
      {...rest}
      type="button"
      role="combobox"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-invalid={invalid}
      data-value={value}
      className={cn(
        'flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-left text-sm disabled:opacity-50 aria-invalid:border-destructive',
        value === '' && 'text-muted-foreground',
      )}
    >
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="break-all">
          {value === '' ? placeholder || t('models.default') : (known?.name ?? value)}
        </span>
        {known && known.name !== known.id ? (
          <span className="break-all text-xs text-muted-foreground">{known.id}</span>
        ) : null}
        {notInList ? (
          <span className="text-xs text-status-warn">{t('models.notInList')}</span>
        ) : null}
      </span>
      <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
    </button>
  );
}

function ModelGroups(props: {
  models: ModelEntry[];
  value: string;
  typed: string;
  canCreate: boolean;
  pick: (next: string) => void;
}) {
  const { models, value, typed, canCreate, pick } = props;
  const { t } = useTranslation();
  return (
    <>
      {typed === '' ? (
        <CommandGroup>
          <CommandItem value={DEFAULT} onSelect={() => pick('')}>
            <Check className={value === '' ? 'opacity-100' : 'opacity-0'} />
            {t('models.default')}
          </CommandItem>
        </CommandGroup>
      ) : null}
      {groupModels(models).map(({ group, models: entries }) => (
        <CommandGroup
          key={group}
          heading={group === 'aliases' ? t('models.groups.aliases') : group}
        >
          {entries.map((model) => (
            <ModelOption
              key={model.id}
              model={model}
              chosen={model.id === value}
              onSelect={() => pick(model.id)}
            />
          ))}
        </CommandGroup>
      ))}
      {canCreate ? (
        <CommandGroup>
          <CommandItem value={`${CREATE}:${typed}`} onSelect={() => pick(typed)}>
            <Plus />
            {t('models.useTyped', { value: typed })}
          </CommandItem>
        </CommandGroup>
      ) : null}
    </>
  );
}

/**
 * A single choice of a model with a searchable list in groups. The list only helps: a typed value
 * that is not in it is kept as it is, and the empty value means «by default».
 */
export function ModelPicker(props: ModelPickerProps) {
  const { id, label, value, onChange, models, error, loading, onRefresh, placeholder } = props;
  const { disabled = false, invalid = false } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const known = models.find((model) => model.id === value);
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <ModelTrigger
          {...{ id, label, value, known, open, placeholder, disabled, invalid }}
          notInList={value !== '' && models.length > 0 && !known}
        />
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <Command shouldFilter={false} label={t('picker.search', { label })}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('picker.searchOrType')}
          />
          <CommandList>
            <CommandEmpty>{t('picker.nothing')}</CommandEmpty>
            <ModelGroups
              models={matchingModels(models, query)}
              value={value}
              typed={typed}
              canCreate={typed !== '' && !models.some((model) => model.id === typed)}
              pick={pick}
            />
          </CommandList>
          <ModelFooter error={error} loading={loading} onRefresh={onRefresh} />
        </Command>
      </PopoverContent>
    </Popover>
  );
}
