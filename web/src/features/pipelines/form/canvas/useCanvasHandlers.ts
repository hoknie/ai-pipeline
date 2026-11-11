import { useCallback, type KeyboardEvent } from 'react';

import { newStepDraft } from '../steps/draft.ts';
import type { CanvasNode as CanvasNodeType } from '../steps/draftGraph.ts';
import { connectReturn, insertStep, removeStep, setReturn } from '../steps/draftOps.ts';
import type { usePipelineEditor } from '../usePipelineEditor.ts';
import { reconnectOutcome, type ReconnectOutcome } from './canvasAnchors.ts';
import { isRemoveKey } from './canvasKeys.ts';
import type { Selection } from './canvasModel.ts';
import type { useCanvasGraph } from './useCanvasGraph.ts';

/** What a click on a plus and the Delete key do to the draft, and where a dropped node is remembered. */
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
  /** A drag only moves the node; the order of the steps is not touched. */
  const onDragStop = (_: unknown, dropped: CanvasNodeType) => flow.onDragStop(dropped);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isRemoveKey(event) || !editable || !selection) return;
    if (selection.kind === 'step') setDraft((current) => removeStep(current, selection.key));
    else if (selection.kind === 'return') {
      setDraft((current) => setReturn(current, selection.key, null));
    } else return;
    event.preventDefault();
  };
  /** A dragged end of a connection: new sides of its ends, or a new step for the end of a return. */
  const onReconnect = (
    oldEdge: { id: string; source: string; target: string },
    connection: {
      source: string;
      target: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => {
    const outcome: ReconnectOutcome | null = reconnectOutcome(
      oldEdge,
      connection,
      editor.draft,
      editable,
    );
    if (!outcome) return;
    if (outcome.kind === 'sides') {
      flow.setAnchor(flow.anchorKeyOf(oldEdge), outcome.sides);
      return;
    }
    setDraft((current) => connectReturn(current, outcome));
    if (outcome.targetSide) {
      const moved = { id: oldEdge.id, source: oldEdge.source, target: outcome.target };
      flow.setAnchor(flow.anchorKeyOf(moved), { target: outcome.targetSide });
    }
  };
  return { onAdd, onDragStop, onKeyDown, onReconnect };
}
