import { useCallback, type KeyboardEvent } from 'react';

import { newStepDraft } from '../steps/draft.ts';
import type { CanvasNode as CanvasNodeType } from '../steps/draftGraph.ts';
import {
  dropIndex,
  insertStep,
  moveStep,
  removeStep,
  setReturn,
  stepKeyOfNode,
} from '../steps/draftOps.ts';
import type { usePipelineEditor } from '../usePipelineEditor.ts';
import { isRemoveKey } from './canvasKeys.ts';
import type { Selection } from './canvasModel.ts';
import type { useCanvasGraph } from './useCanvasGraph.ts';

/** What a click on a plus, the end of a drag and the Delete key do to the draft. */
export function useCanvasHandlers(
  editor: ReturnType<typeof usePipelineEditor>,
  flow: ReturnType<typeof useCanvasGraph>,
  selection: Selection | null,
  editable: boolean,
  setChosen: (selection: Selection | null) => void,
) {
  const { setDraft } = editor;
  const onAdd = useCallback(
    (index: number) => {
      const step = newStepDraft();
      setDraft((current) => insertStep(current, index, step).draft);
      setChosen({ kind: 'step', key: step.key });
    },
    [setDraft, setChosen],
  );
  const onDragStop = (_: unknown, dragged: CanvasNodeType) => {
    const key = stepKeyOfNode(dragged.id);
    if (key !== null) {
      const others = flow.nodes.filter(
        (item) => item.data.kind === 'step' && item.id !== dragged.id,
      );
      const to = dropIndex(
        others.map((item) => item.position.x),
        dragged.position.x,
      );
      setDraft((current) => moveStep(current, key, to));
    }
    flow.resetNodes();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isRemoveKey(event) || !editable || !selection) return;
    if (selection.kind === 'step') setDraft((current) => removeStep(current, selection.key));
    else if (selection.kind === 'return') {
      setDraft((current) => setReturn(current, selection.key, null));
    } else return;
    event.preventDefault();
  };
  return { onAdd, onDragStop, onKeyDown };
}
