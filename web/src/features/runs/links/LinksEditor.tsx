import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { taskNumber } from '../../../shared/lib/format.ts';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../shared/ui/overlays/command.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/overlays/popover.tsx';
import { linkKinds, type LinkKind } from './linkKinds.ts';
import type { LinkTarget, LinkTargetGroup } from './linkTargets.ts';

export interface LinkRow {
  kind: LinkKind;
  target: string;
}

export interface LinksEditorProps {
  value: LinkRow[];
  onChange: (links: LinkRow[]) => void;
  choices: (kind: LinkKind) => LinkTargetGroup[];
  editableKinds?: readonly LinkKind[];
  disabled?: boolean;
  /** The «Add link» row button; a caller with its own submit button turns it off. */
  addButton?: boolean;
  /** Classes of the legend; by default the heading of a stand-alone block. */
  legendClassName?: string;
}

function targetLabel(target: LinkTarget): string {
  const task =
    target.number === null ? target.title : `${taskNumber(target.number)} ${target.title}`;
  return target.project ? `${target.project} · ${task}` : task;
}

function TargetGroups({
  groups,
  value,
  pick,
}: {
  groups: LinkTargetGroup[];
  value: string;
  pick: (id: string) => void;
}) {
  const { t } = useTranslation();
  return groups.map((group) => (
    <CommandGroup key={group.section} heading={t(`links.sections.${group.section}`)}>
      {group.options.map((option) => (
        <CommandItem
          key={option.id}
          value={option.id}
          title={targetLabel(option)}
          onSelect={() => pick(option.id)}
        >
          <Check className={option.id === value ? 'shrink-0 opacity-100' : 'shrink-0 opacity-0'} />
          <span className="line-clamp-3 min-w-0 [overflow-wrap:anywhere]">
            {targetLabel(option)}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  ));
}

function TargetPicker({
  value,
  groups,
  onChange,
  disabled,
}: {
  value: string;
  groups: LinkTargetGroup[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const label = t('links.target');
  const selected = groups.flatMap((group) => group.options).find((option) => option.id === value);
  const text = selected ? targetLabel(selected) : value;
  const search = query.trim().toLocaleLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) =>
        targetLabel(option).toLocaleLowerCase().includes(search),
      ),
    }))
    .filter((group) => group.options.length > 0);
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
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          title={text || undefined}
          className="flex h-9.5 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm disabled:opacity-50"
        >
          <span className="min-w-0 truncate">{text || label}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[min(20rem,90vw)] max-w-[min(32rem,90vw)] p-0">
        <Command shouldFilter={false} label={t('picker.search', { label })}>
          <CommandInput
            aria-label={t('picker.search', { label })}
            value={query}
            onValueChange={setQuery}
            placeholder={t('picker.searchOnly')}
          />
          <CommandList>
            <CommandEmpty>{t('picker.nothing')}</CommandEmpty>
            <TargetGroups
              groups={visible}
              value={value}
              pick={(id) => {
                onChange(id);
                setOpen(false);
                setQuery('');
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One row «kind / task / ×»: the kind select drops a target the new kind does not offer. */
function Row({
  row,
  index,
  locked,
  hasParent,
  choices,
  editableKinds,
  update,
  remove,
}: {
  row: LinkRow;
  index: number;
  locked: boolean;
  hasParent: boolean;
  choices: LinksEditorProps['choices'];
  editableKinds: readonly LinkKind[];
  update: (index: number, row: LinkRow) => void;
  remove: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Select
        value={row.kind}
        disabled={locked}
        onValueChange={(value) => {
          const kind = value as LinkKind;
          const offered = choices(kind).some((group) =>
            group.options.some((option) => option.id === row.target),
          );
          update(index, { kind, target: offered ? row.target : '' });
        }}
      >
        <SelectTrigger aria-label={t('links.kindLabel')} className="w-44 max-w-[40%] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {linkKinds
            .filter((kind) => editableKinds.includes(kind) || kind === row.kind)
            .map((kind) => (
              <SelectItem
                key={kind}
                value={kind}
                disabled={kind === 'parent' && row.kind !== 'parent' && hasParent}
              >
                {t(`links.kind.${kind}`)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <div className="min-w-0 flex-1">
        <TargetPicker
          value={row.target}
          groups={choices(row.kind)}
          disabled={locked}
          onChange={(target) => update(index, { ...row, target })}
        />
      </div>
      <button
        type="button"
        aria-label={t('links.remove')}
        title={t('links.remove')}
        disabled={locked}
        className="flex size-9.5 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
        onClick={() => remove(index)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** A controlled list of link rows; kinds outside editableKinds stay visible but locked. */
export function LinksEditor({
  value,
  onChange,
  choices,
  editableKinds = linkKinds,
  disabled = false,
  addButton = true,
  legendClassName,
}: LinksEditorProps) {
  const { t } = useTranslation();
  const hasParent = value.some((row) => row.kind === 'parent');
  const available = editableKinds.filter((kind) => kind !== 'parent' || !hasParent);
  const update = (index: number, row: LinkRow) =>
    onChange(value.map((old, i) => (i === index ? row : old)));
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0" disabled={disabled}>
      <legend className={legendClassName ?? 'mb-1 text-sm font-medium'}>{t('links.title')}</legend>
      {value.map((row, index) => (
        <Row
          key={index}
          {...{ row, index, choices, editableKinds, update, hasParent }}
          locked={disabled || !editableKinds.includes(row.kind)}
          remove={(at) => onChange(value.filter((_, i) => i !== at))}
        />
      ))}
      {addButton ? (
        <Button
          variant="outline"
          disabled={disabled || available.length === 0}
          className="mt-1 self-start"
          onClick={() => {
            const kind = available[0];
            if (kind) onChange([...value, { kind, target: '' }]);
          }}
        >
          <Plus aria-hidden />
          {t('links.add')}
        </Button>
      ) : null}
    </fieldset>
  );
}
