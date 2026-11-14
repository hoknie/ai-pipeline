import { GitBranch } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { PipelineCanvas } from './canvas/PipelineCanvas.tsx';
import type { usePipelineEditor } from './usePipelineEditor.ts';
import { appliedView } from './variants/variantDraft.ts';
import { variantTitle } from './variants/VariantSwitcher.tsx';

type Editor = ReturnType<typeof usePipelineEditor>;

/** The editor as the chosen variant shows it: its specialists, nothing editable. */
function useVariantEditor(editor: Editor) {
  const variant = editor.draft.variants.find((item) => item.key === editor.variant) ?? null;
  return useMemo(() => {
    if (!variant) return null;
    const view = appliedView(editor.draft.steps, editor.draft.split, variant);
    return {
      variant,
      skipped: view.skipped,
      editor: {
        ...editor,
        draft: { ...editor.draft, steps: view.steps, split: view.split },
        setDraft: () => {},
      } as Editor,
    };
    // `editor` changes on every render; what the diagram shows depends on these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, editor.draft, editor.errors, editor.preview, editor.id, editor.tab]);
}

/** The diagram of the draft: it edits the draft the form edits; the daemon checks it. */
export function SchemaTab({
  editor,
  view,
  sharedOnly,
  disabled,
}: {
  editor: Editor;
  view: ConfigEditorResponse;
  sharedOnly: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { stale } = editor.preview;
  const shown = useVariantEditor(editor);
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t('pipelines.schemaLabel')}>
      <h3 className="flex items-center gap-2 font-semibold">
        <GitBranch className="size-4" aria-hidden />
        {t('pipelines.schema')}{' '}
        {stale ? <Badge variant="warn">{t('pipelines.stale')}</Badge> : null}
      </h3>
      {stale ? (
        <p className="text-sm text-muted-foreground">{t('pipelines.previewInvalid')}</p>
      ) : null}
      {shown ? (
        <Alert role="status">
          {t('variants.schemaNote', { name: variantTitle(shown.variant) })}
        </Alert>
      ) : null}
      <PipelineCanvas
        editor={shown?.editor ?? editor}
        view={view}
        sharedOnly={sharedOnly}
        disabled={disabled || shown !== null}
        {...(shown ? { skipped: shown.skipped } : {})}
      />
    </section>
  );
}
