import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { ChainForm } from './ChainForm.tsx';
import { NEW_CHAIN } from './ChainsList.tsx';

export interface ChainsPaneProps {
  api: Api;
  view: ConfigEditorResponse | null;
  failure: string | null;
  selected: string | null;
  dirty: { current: boolean };
  scope?: 'global' | null;
  load: () => Promise<void>;
  onSelect: (slug: string | null) => void;
}

export function ChainsPane({
  api,
  view,
  failure,
  selected,
  dirty,
  scope,
  load,
  onSelect,
}: ChainsPaneProps) {
  const { t } = useTranslation();

  if (!view) {
    if (failure) return null;
    return (
      <div role="status" aria-label={t('settings.editor.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }

  const chains = scope
    ? view.chains.filter((c) => c.level === 'global' || c.sources.global)
    : view.chains;
  const chain = chains.find((c) => c.slug === selected) ?? null;

  if (selected !== NEW_CHAIN && !chain) {
    return <Empty icon={<Layers />} title={t('chains.empty')} />;
  }

  const saved = async (slug: string) => {
    dirty.current = false;
    await load();
    notifySuccess(t('chains.savedToast'));
    if (selected === NEW_CHAIN || slug !== selected) onSelect(slug);
  };

  const deleted = async () => {
    if (!chain) return;
    dirty.current = false;
    await load();
    const removedOverride = !scope && Boolean(chain.sources.global && chain.sources.project);
    notifySuccess(
      removedOverride
        ? t('chains.overrideRemovedToast', { slug: chain.slug })
        : t('chains.deletedToast', { slug: chain.slug }),
    );
    if (!removedOverride) onSelect(null);
  };

  return (
    <ChainForm
      key={
        chain
          ? `${chain.slug}:${chain.level}:${chain.sources.project?.revision ?? ''}:${chain.sources.global?.revision ?? ''}`
          : 'new'
      }
      api={api}
      chain={chain}
      scope={scope}
      onDirty={(val) => {
        dirty.current = val;
      }}
      onSaved={saved}
      onDeleted={deleted}
    />
  );
}
