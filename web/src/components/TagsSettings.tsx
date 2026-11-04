import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { notifySuccess } from '../notify.ts';
import { TAG_COLOR_NAMES } from '../tagColors.ts';
import { useTags } from '../tags.tsx';
import type { TagColor, TagView } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Card } from '../ui/card.tsx';
import { Empty } from '../ui/empty.tsx';
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

  const row = (tag: TagView, withColor: boolean) => (
    <li key={tag.id} data-tag-row={tag.id} className="flex flex-col gap-1 py-2">
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

  const ordinary = catalog.tags.filter((tag) => !tag.task);
  const linked = catalog.tags.filter((tag) => tag.task);

  return (
    <section aria-label={t('tags.settings.label')} className="flex flex-col gap-3">
      <Card>
        <section aria-labelledby="tags-ordinary" className="flex flex-col gap-2 p-4">
          <h3 id="tags-ordinary" className="text-sm font-semibold">
            {t('tags.settings.ordinaryTitle')}
          </h3>
          {ordinary.length === 0 ? (
            <Empty title={t('tags.none')} />
          ) : (
            <ul className="flex flex-col divide-y">{ordinary.map((tag) => row(tag, true))}</ul>
          )}
        </section>
      </Card>
      {linked.length > 0 ? (
        <Card>
          <section aria-labelledby="tags-linked" className="flex flex-col gap-2 p-4">
            <h3 id="tags-linked" className="text-sm font-semibold">
              {t('tags.settings.linkedTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('tags.settings.linkedHint')}</p>
            <ul className="flex flex-col divide-y">{linked.map((tag) => row(tag, false))}</ul>
          </section>
        </Card>
      ) : null}
    </section>
  );
}
