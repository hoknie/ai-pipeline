import { useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { cn } from '../../lib/browser/cn.ts';
import type { MarkupAction } from '../../lib/markdown/markdownMarkup.ts';
import { MarkupToolbar } from './MarkupToolbar.tsx';
import { commands } from './markdown/commands.ts';
import { MarkdownSource } from './markdown/MarkdownSource.tsx';
import { VisualEditor } from './markdown/VisualEditor.tsx';
import { LinkEditor } from './markdown/LinkEditor.tsx';

interface MarkdownFieldProps {
  id?: string;
  'aria-label': string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  grow?: boolean;
}

export function MarkdownField({
  id,
  'aria-label': label,
  value,
  onChange,
  rows = 4,
  placeholder,
  disabled,
  grow = false,
}: MarkdownFieldProps) {
  const [source, setSource] = useState(false);
  const [linkView, setLinkView] = useState<EditorView | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const visual = useRef<HTMLDivElement>(null);
  const active = useRef<EditorView | null>(null);
  const focusAfterToggle = useRef(false);
  useLayoutEffect(() => {
    setLinkView(null);
  }, [disabled, value]);
  useLayoutEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    if (source) area.current?.focus();
    else visual.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
  }, [source]);
  function mark(action: MarkupAction) {
    const editor = active.current;
    if (!editor || editor.isDestroyed || disabled || source) return;
    if (action === 'link') {
      setLinkView(editor);
      return;
    }
    commands[action]?.(editor.state, editor.dispatch, editor);
    editor.focus();
  }
  const height = `${Math.max(rows, 2) * 1.25 + 0.75}rem`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', grow && 'flex-1')}>
      <MarkupToolbar
        editing={!disabled}
        source={source}
        onSource={() => {
          focusAfterToggle.current = true;
          setLinkView(null);
          setSource(!source);
        }}
        onMark={mark}
      />
      {linkView && <LinkEditor view={linkView} close={() => setLinkView(null)} />}
      {source ? (
        <MarkdownSource
          inputRef={area}
          id={id}
          aria-label={label}
          rows={rows}
          className={grow ? 'flex-1' : undefined}
          style={grow ? { minHeight: height } : undefined}
          value={value}
          placeholder={placeholder}
          readOnly={disabled}
          onChange={onChange}
        />
      ) : (
        <VisualEditor
          visual={visual}
          active={active}
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          grow={grow}
          height={height}
          onLink={setLinkView}
        />
      )}
    </div>
  );
}
