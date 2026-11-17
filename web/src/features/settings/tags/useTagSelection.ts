import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';

/** The tags of a project picked for deletion: the selection lives until the project changes. */
export function useTagSelection(api: Api, repository: string) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const catalog = useTags();
  const own = catalog.of(repository);
  const [picked, setPicked] = useState<{ repository: string; ids: string[] }>({
    repository,
    ids: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only the tags still in the catalog of this project stay selected.
  if (picked.repository !== repository) setPicked({ repository, ids: [] });
  const raw = picked.repository === repository ? picked.ids : [];
  const present = new Set(own.map((tag) => tag.id));
  const selected = raw.filter((id) => present.has(id));
  const update = (ids: string[]) => {
    setPicked({ repository, ids });
    setError(null);
  };

  const toggle = (id: string) =>
    update(selected.includes(id) ? selected.filter((one) => one !== id) : [...selected, id]);
  const toggleAll = (ids: string[]) =>
    update(
      ids.every((id) => selected.includes(id))
        ? selected.filter((id) => !ids.includes(id))
        : [...selected, ...ids.filter((id) => !selected.includes(id))],
    );
  const clear = () => update([]);

  const removeSelected = async () => {
    const tags = own.filter((tag) => selected.includes(tag.id));
    if (tags.length === 0) return;
    const yes = await confirm({
      title: t('tags.settings.removeSelectedTitle', { count: tags.length }),
      description: t('tags.settings.removeSelectedDescription'),
      confirmLabel: t('tags.settings.remove'),
      cancelLabel: t('tags.settings.keep'),
      destructive: true,
    });
    if (!yes) return;
    setBusy(true);
    setError(null);
    try {
      catalog.update(
        repository,
        await api.forRepository(repository).removeTags(tags.map((tag) => tag.name)),
      );
      setPicked({ repository, ids: [] });
      notifySuccess(t('tags.settings.removedMany', { count: tags.length }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { selected, error, busy, toggle, toggleAll, clear, removeSelected };
}
