import { Check, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import type { TagView } from '../types.ts';
import { useTags } from '../tags.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { TagLabel } from './TagChip.tsx';

const CREATE = '__create';

/**
 * A multiselect of catalog tags (by id): chips with removal and a popover with a searchable
 * list. With `allowCreate` and an `api`, a name that matches no tag (ignoring case) offers
 * «Create tag «x»», which creates the tag and selects it.
 */
export function TagPicker({
  id,
  label,
  selected,
  onChange,
  repository,
  api,
  allowCreate = false,
  disabled = false,
  chips = true,
  hideLinked = false,
}: {
  id?: string;
  label: string;
  selected: string[];
  /** `fresh` is the updated catalog when the change created a tag. */
  onChange: (ids: string[], fresh?: TagView[]) => void;
  /** The repository whose catalog is offered; tags of other repositories are not. */
  repository: string | null;
  api?: Api;
  allowCreate?: boolean;
  disabled?: boolean;
  /** Show the chips of the selection next to the button. */
  chips?: boolean;
  /** Hide the tags of linked tasks (set automatically) and forbid removing them. */
  hideLinked?: boolean;
}) {
  const { t } = useTranslation();
  const catalog = useTags();
  const own = catalog.of(repository);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = query.trim();
  const needle = typed.toLowerCase();
  const visible = own.filter(
    (tag) =>
      !(hideLinked && tag.task) && (needle === '' || tag.name.toLowerCase().includes(needle)),
  );
  const pickable = own.filter((tag) => !(hideLinked && tag.task));
  const canCreate =
    allowCreate &&
    api !== undefined &&
    repository !== null &&
    typed !== '' &&
    !own.some((tag) => tag.name.toLowerCase() === needle);

  const toggle = (tagId: string) => {
    setError(null);
    onChange(selected.includes(tagId) ? selected.filter((v) => v !== tagId) : [...selected, tagId]);
    setQuery('');
  };

  const create = async () => {
    if (!api || repository === null || creating) return;
    setCreating(true);
    setError(null);
    try {
      const list = await api.forRepository(repository).addTag(typed);
      catalog.update(repository, list);
      const made = list.find((tag) => tag.name.toLowerCase() === needle);
      if (made && !selected.includes(made.id)) onChange([...selected, made.id], list);
      setQuery('');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const chosen = selected.flatMap((tagId) => {
    const tag = catalog.byId.get(tagId);
    return tag ? [tag] : [];
  });

  return (
    <div className="flex flex-col gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <div className="flex min-h-9.5 w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5">
          {chips
            ? chosen.map((tag) => (
                <span key={tag.id} className="inline-flex items-center gap-0.5">
                  <TagLabel tag={tag} />
                  {hideLinked && tag.task ? null : (
                    <button
                      type="button"
                      aria-label={t('tags.remove', { name: tag.name })}
                      disabled={disabled}
                      className="rounded-full p-0.5 hover:bg-accent disabled:opacity-50"
                      onClick={() => toggle(tag.id)}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))
            : null}
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
        <PopoverContent className="p-0">
          <Command shouldFilter={false} label={t('picker.search', { label })}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={allowCreate ? t('tags.searchOrCreate') : t('picker.searchOnly')}
            />
            <CommandList id={listId}>
              {visible.length === 0 && !canCreate ? (
                <CommandEmpty>
                  {pickable.length === 0 ? t('tags.none') : t('picker.nothing')}
                </CommandEmpty>
              ) : null}
              {visible.length > 0 ? (
                <CommandGroup>
                  {visible.map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={`tag:${tag.id}`}
                      onSelect={() => toggle(tag.id)}
                    >
                      <Check className={selected.includes(tag.id) ? 'opacity-100' : 'opacity-0'} />
                      <TagLabel tag={tag} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {canCreate ? (
                <CommandGroup>
                  <CommandItem value={`${CREATE}:${typed}`} onSelect={() => void create()}>
                    <Plus />
                    {t('tags.create', { name: typed })}
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
