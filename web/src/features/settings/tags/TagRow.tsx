import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TAG_COLOR_NAMES } from '../../../shared/lib/catalog/tagColors.ts';
import type { TagColor, TagView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { TagLabel } from '../../../shared/ui/feedback/TagChip.tsx';
import type { useTagEdits } from './useTagEdits.ts';

/** One tag of the catalog: its name, color and the removal; a linked tag has no color. */
export function TagRow({
  tag,
  withColor,
  edits,
}: {
  tag: TagView;
  withColor: boolean;
  edits: ReturnType<typeof useTagEdits>;
}) {
  const { t } = useTranslation();
  const { names, setNames, errors, busy, edit, saveName, remove } = edits;
  return (
    <li data-tag-row={tag.id} className="flex flex-col gap-1 py-2">
      <div
        data-tag-cells
        className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[10rem_minmax(0,16rem)_9rem_auto]"
      >
        <span className="min-w-0">
          <TagLabel tag={tag} />
        </span>
        <Input
          aria-label={t('tags.settings.name', { name: tag.name })}
          className="w-full"
          value={names[tag.id] ?? tag.name}
          disabled={busy === tag.id}
          onChange={(event) => setNames({ ...names, [tag.id]: event.target.value })}
          onBlur={() => saveName(tag)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveName(tag);
          }}
        />
        {withColor ? (
          <Select
            value={tag.color}
            disabled={busy === tag.id}
            onValueChange={(color) => void edit(tag, { color: color as TagColor })}
          >
            <SelectTrigger
              aria-label={t('tags.settings.color', { name: tag.name })}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAG_COLOR_NAMES.map((color) => (
                <SelectItem key={color} value={color}>
                  {t(`tags.colors.${color}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span aria-hidden="true" data-tag-color-placeholder />
        )}
        <Button
          variant="ghost"
          size="icon"
          disabled={busy === tag.id}
          aria-label={t('tags.settings.removeLabel', { name: tag.name })}
          title={t('tags.settings.removeLabel', { name: tag.name })}
          onClick={() => void remove(tag)}
        >
          <Trash2 />
        </Button>
      </div>
      {errors[tag.id] ? (
        <p role="alert" className="text-xs text-destructive">
          {errors[tag.id]}
        </p>
      ) : null}
    </li>
  );
}
