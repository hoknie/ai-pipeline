import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import type { TagColor, TagView } from '../../../shared/api/types.ts';

/** Editing the tags of a project: the typed names, the errors, and the requests. */
export function useTagEdits(api: Api, repository: string) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const catalog = useTags();
  const scoped = api.forRepository(repository);
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
      catalog.update(repository, await scoped.editTag(tag.name, patch));
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
      catalog.update(repository, await scoped.removeTag(tag.name));
      notifySuccess(t('tags.settings.removed'));
    } catch (error) {
      fail(tag.id, (error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { names, setNames, errors, busy, edit, saveName, remove };
}
