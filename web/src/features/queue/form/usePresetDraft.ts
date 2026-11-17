import { useEffect, useRef } from 'react';
import type { PipelinesView } from '../../../shared/api/types.ts';
import { emptyDraft, type QueueDraft } from '../draft.ts';

export function useOpenTarget(
  open: boolean,
  selected: string,
  preset: { repository: string } | null,
  setTarget: (target: string) => void,
  reset: () => void,
) {
  const wasOpen = useRef(false);
  const latest = useRef({ selected, preset, reset });
  latest.current = { selected, preset, reset };
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTarget(latest.current.preset?.repository ?? latest.current.selected);
      latest.current.reset();
    }
    wasOpen.current = open;
  }, [open, setTarget]);
}

/** The preset parent goes into the draft once, when the draft belongs to the target repository. */
export function usePresetDraft(input: {
  open: boolean;
  preset: { repository: string; parent: string | null } | null;
  target: string;
  draft: QueueDraft | undefined;
  draftTarget: string | null;
  pipelines: PipelinesView | null;
  onDraft: (draft: QueueDraft | null) => void;
  onPresetApplied: () => void;
}): void {
  const { open, preset, target, draft, draftTarget, pipelines, onDraft, onPresetApplied } = input;
  useEffect(() => {
    if (!open || !preset || target !== preset.repository) return;
    if (draft && draftTarget !== target) return;
    if (!pipelines) return;
    const base = draft ?? emptyDraft(pipelines.pipelines[0]?.id);
    onDraft(
      preset.parent === null
        ? { ...base, repository: target }
        : {
            ...base,
            repository: target,
            links: [
              ...base.links.filter((link) => link.kind !== 'parent'),
              { kind: 'parent', target: preset.parent },
            ],
            linksTouched: true,
          },
    );
    onPresetApplied();
  }, [open, preset, target, draft, draftTarget, pipelines, onDraft, onPresetApplied]);
}

/** The draft with the first pipeline when it started before the pipelines were known. */
export function useEffectiveDraft(
  draft: QueueDraft,
  pipelines: PipelinesView | null,
  onDraft: (draft: QueueDraft) => void,
) {
  const ids = pipelines?.pipelines.map((pipeline) => pipeline.id) ?? [];
  const effective: QueueDraft =
    draft.pipeline === '' && ids[0] ? { ...draft, pipeline: ids[0] } : draft;
  return {
    ids,
    effective,
    change: (patch: Partial<QueueDraft>) => onDraft({ ...effective, ...patch }),
  };
}
