import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ProviderView } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../shared/ui/overlays/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/overlays/popover.tsx';
import { providerLabel } from '../list/label.ts';
import { StatusIcon, useStatusText } from '../list/ProviderStatus.tsx';
import { reasonText } from '../list/reasons.ts';
import { matchProviders } from './match.ts';
import { ProviderCreateDialog } from './ProviderCreateDialog.tsx';

const EMPTY = '__empty';
const CREATE = '__create';

export interface ProviderPickerProps {
  id?: string;
  /** The accessible name of the field. */
  label: string;
  /** The chosen slug; `null`: the empty choice. */
  value: string | null;
  onChange: (slug: string | null) => void;
  providers: readonly ProviderView[];
  /** The label of the empty choice («Not chosen»); without it an empty choice is not offered. */
  emptyLabel?: string;
  /** What the button says while nothing is chosen and there is no empty choice. */
  placeholder?: string;
  /** The project whose registry gets the provider created from the list. */
  repository: string | null;
  api: Api;
  invalid?: boolean;
  disabled?: boolean;
  /** The slug that is in use now: marked «(current)» in the list. */
  current?: string | null;
  /** The default provider of the project(s): marked «default» in the list. */
  defaultSlug?: string | null;
}

function useStatusLine() {
  const { t } = useTranslation();
  const statusText = useStatusText();
  return (provider: ProviderView): string => {
    const first = provider.access.flatMap((access) => access.reasons)[0];
    return provider.status === 'unavailable' && first
      ? `${statusText('unavailable')} · ${reasonText(first, t)}`
      : statusText(provider.status);
  };
}

/** One choice: name, slug, status icon and text. */
function ProviderOption({
  provider,
  chosen,
  current,
  isDefault,
  onSelect,
}: {
  provider: ProviderView;
  chosen: boolean;
  current: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const line = useStatusLine();
  return (
    <CommandItem
      value={`provider:${provider.slug}`}
      disabled={!provider.enabled && !chosen}
      onSelect={onSelect}
    >
      <Check className={chosen ? 'opacity-100' : 'opacity-0'} />
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-all">{provider.name}</span>
          <span className="text-xs text-muted-foreground">{provider.slug}</span>
          {current ? (
            <span className="text-xs text-muted-foreground">{t('providers.picker.current')}</span>
          ) : null}
          {isDefault ? (
            <span className="text-xs text-muted-foreground">{t('providers.picker.default')}</span>
          ) : null}
        </span>
        <span
          className={cn(
            'flex items-center gap-1 text-xs',
            provider.status === 'available' ? 'text-status-ok' : 'text-muted-foreground',
          )}
        >
          <StatusIcon status={provider.status} />
          {line(provider)}
        </span>
      </span>
    </CommandItem>
  );
}

/** The button of the combobox: the status icon, the name, the status when not available. */
function PickerTrigger(
  props: ComponentProps<'button'> & {
    label: string;
    chosen: string | null;
    known: ProviderView | undefined;
    emptyLabel: string | undefined;
    placeholder: string | undefined;
    open: boolean;
    invalid: boolean;
  },
) {
  const { label, chosen: value, known, emptyLabel, placeholder, open, invalid, ...rest } = props;
  const { t } = useTranslation();
  const statusText = useStatusText();
  const name =
    value === null
      ? (emptyLabel ?? placeholder ?? '')
      : known
        ? providerLabel(known.slug, known.name)
        : value;
  return (
    <button
      {...rest}
      type="button"
      role="combobox"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-invalid={invalid}
      data-provider-value={value ?? ''}
      className={cn(
        'flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-left text-sm disabled:opacity-50 aria-invalid:border-destructive',
        value === null && 'text-muted-foreground',
      )}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
        {known ? <StatusIcon status={known.status} /> : null}
        <span className="break-all">{name}</span>
        {known && known.status !== 'available' ? (
          <span className="text-xs text-muted-foreground">{statusText(known.status)}</span>
        ) : null}
        {value !== null && !known ? (
          <span className="text-xs text-status-warn">{t('providers.picker.unknown')}</span>
        ) : null}
      </span>
      <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
    </button>
  );
}

/** The search field and the groups: the empty choice, the providers, «Create provider…». */
function PickerList(props: {
  label: string;
  query: string;
  onQuery: (query: string) => void;
  providers: readonly ProviderView[];
  value: string | null;
  emptyLabel: string | undefined;
  onPick: (slug: string | null) => void;
  onCreate: (name: string) => void;
  current: string | null | undefined;
  defaultSlug: string | null | undefined;
}) {
  const { label, query, providers, value, emptyLabel, onPick } = props;
  const { t } = useTranslation();
  const typed = query.trim();
  return (
    <Command shouldFilter={false} label={t('providers.picker.search', { label })}>
      <CommandInput
        value={query}
        onValueChange={props.onQuery}
        placeholder={t('providers.picker.searchPlaceholder')}
      />
      <CommandList>
        <CommandEmpty>{t('providers.picker.nothing')}</CommandEmpty>
        {emptyLabel !== undefined && typed === '' ? (
          <CommandGroup>
            <CommandItem value={EMPTY} onSelect={() => onPick(null)}>
              <Check className={value === null ? 'opacity-100' : 'opacity-0'} />
              {emptyLabel}
            </CommandItem>
          </CommandGroup>
        ) : null}
        <CommandGroup>
          {matchProviders(providers, query).map((provider) => (
            <ProviderOption
              key={provider.slug}
              provider={provider}
              chosen={provider.slug === value}
              current={provider.slug === props.current}
              isDefault={provider.slug === props.defaultSlug}
              onSelect={() => onPick(provider.slug)}
            />
          ))}
        </CommandGroup>
        <CommandGroup>
          <CommandItem value={`${CREATE}:${typed}`} onSelect={() => props.onCreate(typed)}>
            <Plus />
            {t('providers.picker.create')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/**
 * The one choice of a provider of the panel: search by name and slug, status of each, disabled
 * ones last and not choosable, and «Create provider…» that opens the form in a dialog.
 */
export function ProviderPicker(props: ProviderPickerProps) {
  const { id, label, value, onChange, providers, emptyLabel, repository, api } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <PickerTrigger
            {...{ id, label, emptyLabel, open }}
            placeholder={props.placeholder}
            chosen={value}
            disabled={props.disabled ?? false}
            known={providers.find((provider) => provider.slug === value)}
            invalid={props.invalid ?? false}
          />
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <PickerList
            {...{ label, query, providers, value, emptyLabel }}
            current={props.current}
            defaultSlug={props.defaultSlug}
            onQuery={setQuery}
            onPick={(slug) => {
              onChange(slug);
              close();
            }}
            onCreate={(name) => {
              setCreating(name);
              close();
            }}
          />
        </PopoverContent>
      </Popover>
      {creating !== null ? (
        <ProviderCreateDialog
          api={api}
          repository={repository}
          name={creating}
          onCreated={(slug) => {
            setCreating(null);
            onChange(slug);
          }}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </>
  );
}
