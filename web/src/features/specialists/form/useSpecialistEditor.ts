import {
  useEditorDerived,
  useEditorFeedback,
  useEditorFields,
  type EditorInput,
} from './editorState.ts';
import { useGuardedActions, useWriteActions, type EditorCallbacks } from './editorActions.ts';

/** Everything the form of a specialist works with: the fields, the feedback, the actions. */
export function useEditorActions(props: EditorInput & EditorCallbacks) {
  const fields = useEditorFields(props.specialist, props.sharedOnly);
  const feedback = useEditorFeedback();
  const derived = useEditorDerived(props, fields, feedback);
  const write = useWriteActions(props, props, fields, feedback, derived);
  const guarded = useGuardedActions(props, props, fields, feedback, derived, write);
  return { ...fields, ...feedback, ...derived, ...write, ...guarded };
}
