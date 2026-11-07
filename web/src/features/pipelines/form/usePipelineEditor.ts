import { useGuardedActions, useWriteActions, type EditorCallbacks } from './editorActions.ts';
import {
  useEditorDerived,
  useEditorFeedback,
  useEditorFields,
  usePreview,
  type EditorInput,
} from './editorState.ts';

/** Everything the form of a pipeline works with: the fields, the feedback, the actions. */
export function usePipelineEditor(props: EditorInput & EditorCallbacks) {
  const fields = useEditorFields(props.pipeline, props.sharedOnly);
  const feedback = useEditorFeedback();
  const derived = useEditorDerived(props, fields);
  const preview = usePreview(props.api, derived.id, derived.value, fields.level, feedback);
  const write = useWriteActions(props, props, fields, feedback, derived);
  const guarded = useGuardedActions(props, props, fields, feedback, derived, write);
  return { ...fields, ...feedback, ...derived, ...write, ...guarded, preview };
}
