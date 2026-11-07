import { Check, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { TagView } from '../../shared/api/types.ts';
import { useTags } from '../../shared/lib/catalog/tags.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../shared/ui/overlays/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../shared/ui/overlays/popover.tsx';
import { TagLabel } from '../../shared/ui/feedback/TagChip.tsx';

const CREATE = '__create';

function ChosenTags({
  tags,
  hideLinked,
  disabled,
  onRemove,
}: {
  tags: TagView[];
  hideLinked: boolean;
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return tags.map((tag) => (
    <span key={tag.id} className="inline-flex items-center gap-0.5">
      <TagLabel tag={tag} />
      {hideLinked && tag.task ? null : (
        <button
          type="button"
          aria-label={t('tags.remove', { name: tag.name })}
          disabled={disabled}
          className="rounded-full p-0.5 hover:bg-accent disabled:opacity-50"
          onClick={() => onRemove(tag.id)}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  ));
}

function TagList({
  listId,
  visible,
  hasTags,
  selected,
  createName,
  onToggle,
  onCreate,
}: {
  listId: string;
  visible: TagView[];
  hasTags: boolean;
  selected: string[];
  /** The name offered for a new tag; `null` offers none. */
  createName: string | null;
  onToggle: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CommandList id={listId}>
      {visible.length === 0 && createName === null ? (
        <CommandEmpty>{hasTags ? t('picker.nothing') : t('tags.none')}</CommandEmpty>
      ) : null}
      {visible.length > 0 ? (
        <CommandGroup>
          {visible.map((tag) => (
            <CommandItem key={tag.id} value={`tag:${tag.id}`} onSelect={() => onToggle(tag.id)}>
              <Check className={selected.includes(tag.id) ? 'opacity-100' : 'opacity-0'} />
              <TagLabel tag={tag} />
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {createName !== null ? (
        <CommandGroup>
          <CommandItem value={`${CREATE}:${createName}`} onSelect={onCreate}>
            <Plus />
            {t('tags.create', { name: createName })}
          </CommandItem>
        </CommandGroup>
      ) : null}
    </CommandList>
  );
}

/** Whether a name that matches no tag of the repository (ignoring case) can be created. */
function canCreateTag(own: TagView[], repository: string | null, typed: string): boolean {
  const needle = typed.toLowerCase();
  return (
    repository !== null && typed !== '' && !own.some((tag) => tag.name.toLowerCase() === needle)
  );
}

/** Creates a tag of the typed name in the catalog and selects it. */
function useCreateTag({
  api,
  repository,
  name,
  selected,
  onChange,
  onDone,
}: {
  api: Api | undefined;
  repository: string | null;
  name: string;
  selected: string[];
  onChange: (ids: string[], fresh?: TagView[]) => void;
  onDone: () => void;
}) {
  const catalog = useTags();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!api || repository === null || creating) return;
    setCreating(true);
    setError(null);
    try {
      const list = await api.forRepository(repository).addTag(name);
      catalog.update(repository, list);
      const made = list.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (made && !selected.includes(made.id)) onChange([...selected, made.id], list);
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setCreating(false);
    }
  };
  return { error, setError, create };
}

function AddTagTrigger({
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

interface TagPickerProps {
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
}

/**
 * A multiselect of catalog tags (by id): chips with removal and a popover with a searchable
 * list. With `allowCreate` and an `api`, a name that matches no tag (ignoring case) offers
 * «Create tag «x»», which creates the tag and selects it.
 */
export function TagPicker(props: TagPickerProps) {
  const { id, label, selected, onChange, repository, api } = props;
  const { allowCreate = false, disabled = false, chips = true, hideLinked = false } = props;
  const { t } = useTranslation();
  const catalog = useTags();
  const own = catalog.of(repository);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const typed = query.trim();
  const needle = typed.toLowerCase();
  const pickable = own.filter((tag) => !(hideLinked && tag.task));
  const visible = pickable.filter(
    (tag) => needle === '' || tag.name.toLowerCase().includes(needle),
  );
  const canCreate = allowCreate && api !== undefined && canCreateTag(own, repository, typed);
  const { error, setError, create } = useCreateTag({
    api,
    repository,
    name: typed,
    selected,
    onChange,
    onDone: () => setQuery(''),
  });

  const toggle = (tagId: string) => {
    setError(null);
    onChange(selected.includes(tagId) ? selected.filter((v) => v !== tagId) : [...selected, tagId]);
    setQuery('');
  };

  const chosen = selected.flatMap((tagId) => catalog.byId.get(tagId) ?? []);

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
          {chips ? (
            <ChosenTags
              tags={chosen}
              hideLinked={hideLinked}
              disabled={disabled}
              onRemove={toggle}
            />
          ) : null}
          <AddTagTrigger id={id} label={label} open={open} listId={listId} disabled={disabled} />
        </div>
        <PopoverContent className="p-0">
          <Command shouldFilter={false} label={t('picker.search', { label })}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={allowCreate ? t('tags.searchOrCreate') : t('picker.searchOnly')}
            />
            <TagList
              listId={listId}
              visible={visible}
              hasTags={pickable.length > 0}
              selected={selected}
              createName={canCreate ? typed : null}
              onToggle={toggle}
              onCreate={() => void create()}
            />
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
