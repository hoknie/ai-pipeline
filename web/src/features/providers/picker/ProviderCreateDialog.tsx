import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { emptyDraft } from '../form/draft.ts';
import { ProviderWizard } from '../form/ProviderWizard.tsx';
import { slugOf } from '../form/slug.ts';
import { useProviderEditor, useProviderRegistry } from '../page/useProviderRegistry.ts';

/**
 * The form of a new provider in a dialog above the current form; the name starts as the text of the
 * search. Saving closes the dialog and hands the slug over; closing without saving changes nothing.
 */
export function ProviderCreateDialog({
  api,
  repository,
  name,
  onCreated,
  onClose,
}: {
  api: Api;
  repository: string | null;
  name: string;
  onCreated: (slug: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { view } = useProviderRegistry(api, repository);
  const { editor } = useProviderEditor(api, repository);
  const initial = useMemo(() => ({ ...emptyDraft(), name, slug: slugOf(name) }), [name]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('providers.create.title')}</DialogTitle>
          <DialogDescription>{t('providers.create.description')}</DialogDescription>
        </DialogHeader>
        <ProviderWizard
          api={api}
          repository={repository}
          slug={null}
          initial={initial}
          registry={view}
          editor={editor}
          onSaved={onCreated}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
