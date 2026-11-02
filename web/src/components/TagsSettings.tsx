import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { notifySuccess } from '../notify.ts';
import { TAG_COLOR_NAMES } from '../tagColors.ts';
import { useTags } from '../tags.tsx';
import type { TagColor, TagView } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import { TagLabel } from './TagChip.tsx';

/** The tag catalog: rename, recolor, delete. The catalog is shared by all repositories. */
export function TagsSettings({ api }: { api: Api }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const catalog = useTags();
  const [names, setNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const fail = (id: string, message: string | null) =>
    setErrors((current) => {
      const { [id]: _removed, ...rest } = current;
      return message === null ? rest : { ...rest, [id]: message };
    });
  const forget = (id: string) =>
    setNames((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });

  const edit = async (tag: TagView, patch: { name?: string; color?: TagColor }) => {
    setBusy(tag.id);
    fail(tag.id, null);
    try {
      catalog.update(await api.editTag(tag.name, patch));
    } catch (error) {
      fail(tag.id, (error as Error).message);
    } finally {
      forget(tag.id);
      setBusy(null);
    }
  };

  const saveName = (tag: TagView) => {
    const next = (names[tag.id] ?? tag.name).trim();
    if (next === tag.name || next === '') return forget(tag.id);
    void edit(tag, { name: next });
  };

  const remove = async (tag: TagView) => {
    const yes = await confirm({
      title: t('tags.settings.removeTitle', { name: tag.name }),
      description: t('tags.settings.removeDescription'),
      confirmLabel: t('tags.settings.remove'),
      cancelLabel: t('tags.settings.keep'),
      destructive: true,
    });
    if (!yes) return;
    setBusy(tag.id);
    fail(tag.id, null);
    try {
      catalog.update(await api.removeTag(tag.name));
      notifySuccess(t('tags.settings.removed'));
    } catch (error) {
      fail(tag.id, (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label={t('tags.settings.label')} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{t('tags.settings.title')}</h3>
      <p className="text-sm text-muted-foreground">{t('tags.settings.hint')}</p>
      {catalog.tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tags.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {catalog.tags.map((tag) => (
            <li key={tag.id} data-tag-row={tag.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <TagLabel tag={tag} />
                <Input
                  aria-label={t('tags.settings.name', { name: tag.name })}
                  className="max-w-48"
                  value={names[tag.id] ?? tag.name}
                  disabled={busy === tag.id}
                  onChange={(event) => setNames({ ...names, [tag.id]: event.target.value })}
                  onBlur={() => saveName(tag)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveName(tag);
                  }}
                />
                <Select
                  value={tag.color}
                  disabled={busy === tag.id}
                  onValueChange={(color) => void edit(tag, { color: color as TagColor })}
                >
                  <SelectTrigger
                    aria-label={t('tags.settings.color', { name: tag.name })}
                    className="w-36"
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
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === tag.id}
                  aria-label={t('tags.settings.removeLabel', { name: tag.name })}
                  onClick={() => void remove(tag)}
                >
                  {t('tags.settings.remove')}
                </Button>
              </div>
              {errors[tag.id] ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors[tag.id]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
