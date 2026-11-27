import type { ClipboardEvent, Ref } from 'react';

import { Textarea } from '../textarea.tsx';
import { safePastedHtml } from './safePaste.ts';

/** Editable Markdown source. Plain clipboard text is left to the browser's normal paste. */
export function MarkdownSource({
  inputRef,
  value,
  onChange,
  ...props
}: {
  inputRef?: Ref<HTMLTextAreaElement>;
  id?: string;
  'aria-label': string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  function paste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (event.currentTarget.readOnly || event.currentTarget.disabled) return;
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (!html) return;
    const markdown = safePastedHtml(html);
    if (markdown === null) return;
    event.preventDefault();
    const area = event.currentTarget;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    area.focus();
    // Prefer a native edit so the textarea's own undo stack contains the paste.
    if (
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, markdown)
    ) {
      return;
    }
    area.setRangeText(markdown, start, end, 'end');
    onChange(area.value);
  }

  return (
    <Textarea
      {...props}
      ref={inputRef}
      value={value}
      onPaste={paste}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
