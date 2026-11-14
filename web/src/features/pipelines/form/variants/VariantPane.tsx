import type { ReactNode } from 'react';

import type { ConfigEditorResponse } from '../../../../shared/api/types.ts';
import type { SpecialistOption } from '../../../../shared/lib/specialistLabels.ts';
import type { usePipelineEditor } from '../usePipelineEditor.ts';
import { newVariant } from './variantDraft.ts';
import { VariantEditor } from './VariantEditor.tsx';
import { VariantSwitcher } from './VariantSwitcher.tsx';

/** The switcher of the variants, and under it the chosen variant or, for `default`, the fields. */
export function VariantPane({
  editor,
  view,
  options,
  disabled,
  children,
}: {
  editor: ReturnType<typeof usePipelineEditor>;
  view: ConfigEditorResponse;
  options: SpecialistOption[];
  disabled: boolean;
  children: ReactNode;
}) {
  const { draft, setDraft } = editor;
  const variant = draft.variants.find((item) => item.key === editor.variant) ?? null;
  return (
    <>
      <VariantSwitcher
        variants={draft.variants}
        selected={variant?.key ?? null}
        disabled={disabled}
        onSelect={editor.setVariant}
        onAdd={() => {
          const added = newVariant(draft.variants);
          setDraft((current) => ({ ...current, variants: [...current.variants, added] }));
          editor.setVariant(added.key);
        }}
      />
      {variant ? (
        <VariantEditor
          draft={draft}
          variant={variant}
          pipelineId={editor.id}
          options={options}
          view={view}
          disabled={disabled}
          errors={editor.errors}
          onDraft={setDraft}
          onRemove={() => {
            setDraft((current) => ({
              ...current,
              variants: current.variants.filter((item) => item.key !== variant.key),
            }));
            editor.setVariant(null);
          }}
        />
      ) : (
        children
      )}
    </>
  );
}
