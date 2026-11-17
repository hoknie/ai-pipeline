import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { ProviderWizard } from '../form/ProviderWizard.tsx';
import { presetDraft, PRESET_IDS, type PresetId } from '../form/presets.ts';
import { useProviderEditor, useProviderRegistry } from './useProviderRegistry.ts';

const presetOf = (value: string | null): PresetId | null =>
  PRESET_IDS.find((id) => id === value) ?? null;

/** The page of one provider (`#providers/<slug>`) or of a new one (`#providers/new`, with a preset). */
export function ProviderFormPage({
  api,
  repository,
  slug,
  preset,
  onLeave,
}: {
  api: Api;
  repository: string | null;
  /** The slug of the provider; null: a new one. */
  slug: string | null;
  preset: string | null;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { view } = useProviderRegistry(api, repository);
  const { editor } = useProviderEditor(api, repository);
  const chosen = presetOf(preset);
  const initial = useMemo(
    () =>
      chosen && view
        ? presetDraft(
            chosen,
            view.roles.map((role) => role.slug),
          )
        : null,
    [chosen, view],
  );
  const waiting = view === null || (slug !== null && editor === null);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <a
          href="#providers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.preventDefault();
            onLeave();
          }}
        >
          <ArrowLeft className="size-4" /> {t('providers.title')}
        </a>
      </div>
      <h2 className="text-lg font-semibold">
        {slug === null ? t('providers.form.newTitle') : t('providers.form.editTitle', { slug })}
      </h2>
      {waiting ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('providers.loading')}
        </p>
      ) : (
        <ProviderWizard
          key={`${slug ?? 'new'}:${chosen ?? ''}`}
          api={api}
          repository={repository}
          slug={slug}
          initial={initial}
          registry={view}
          editor={editor}
          onSaved={() => {
            notifySuccess(t('providers.form.saved'));
            if (slug === null) onLeave();
          }}
          onDeleted={() => {
            notifySuccess(t('providers.form.deleted'));
            onLeave();
          }}
          onCancel={slug === null ? onLeave : undefined}
        />
      )}
    </div>
  );
}
