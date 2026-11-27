import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { parseEditorDocument } from '../../../lib/markdown/editorDocument.ts';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createBlockEditor } from './createBlockEditor.ts';

function updateExternal(view: EditorView | null, last: RefObject<string>, raw: string) {
  if (!view || raw === last.current) return;
  last.current = raw;
  view.updateState(
    EditorState.create({ doc: parseEditorDocument(raw), plugins: view.state.plugins }),
  );
}

/** One document view owns selection and history; unchanged source ranges stay literal. */
export function EditableBlock({
  raw,
  label,
  placeholder,
  id,
  disabled,
  onChange,
  onActive,
  onDestroy,
  onLink,
}: {
  raw: string;
  label: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onActive: (view: EditorView) => void;
  onDestroy: (view: EditorView) => void;
  onLink?: (view: EditorView) => void;
}) {
  const { t } = useTranslation();
  const emptyTaskLabel = t('queue.form.emptyTask');
  const diagramLabels = useRef({ loading: '', error: '', diagram: '' });
  diagramLabels.current = {
    loading: t('queue.form.diagram.loading'),
    error: t('queue.form.diagram.error'),
    diagram: t('queue.form.diagram.caption'),
  };
  const taskLabel = useRef(emptyTaskLabel);
  taskLabel.current = emptyTaskLabel;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const last = useRef(raw);
  const change = useRef(onChange);
  const active = useRef(onActive);
  const destroy = useRef(onDestroy);
  const link = useRef(onLink);
  link.current = onLink;
  change.current = onChange;
  active.current = onActive;
  destroy.current = onDestroy;
  useLayoutEffect(() => {
    if (!host.current) return;
    const editor = createBlockEditor(host.current, {
      raw,
      label,
      placeholder,
      id,
      disabled,
      last,
      change,
      active,
      taskLabel,
      link,
      diagramLabels,
    });
    view.current = editor;
    active.current(editor);
    return () => {
      destroy.current(editor);
      editor.destroy();
      view.current = null;
    };
  }, [disabled, id, label, placeholder]);
  useLayoutEffect(() => {
    view.current?.dom.querySelectorAll('input[data-empty-task]').forEach((input) => {
      input.setAttribute('aria-label', emptyTaskLabel);
    });
  }, [emptyTaskLabel]);
  useLayoutEffect(() => {
    updateExternal(view.current, last, raw);
  }, [raw]);
  return (
    <div
      ref={host}
      className="min-w-0 [&_.ProseMirror]:min-h-6 [&_.ProseMirror]:outline-none [&_strong]:font-bold [&_em]:italic [&_h2]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-3"
    />
  );
}
