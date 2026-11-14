import { useRef, useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/browser/cn.ts';
import { htmlToMarkdown } from '../../lib/markdown/htmlToMarkdown.ts';
import { applyMarkup, type MarkupAction } from '../../lib/markdown/markdownMarkup.ts';
import { MarkupToolbar, type Mode } from './MarkupToolbar.tsx';
import { Textarea } from './textarea.tsx';
import { Markdown } from '../layout/Markdown.tsx';

interface MarkdownFieldProps {
  id?: string;
  'aria-label': string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Takes the free height of its column, never less than `rows` lines. */
  grow?: boolean;
}

/**
 * Replaces a range of the field through the browser, so that its undo history keeps the edit;
 * without `execCommand` the text is set directly.
 */
function replaceRange(
  el: HTMLTextAreaElement,
  from: number,
  to: number,
  text: string,
  onChange: (value: string) => void,
): void {
  el.focus();
  el.setSelectionRange(from, to);
  if (typeof document.execCommand === 'function') {
    const done =
      text === ''
        ? document.execCommand('delete')
        : document.execCommand('insertText', false, text);
    if (done) return;
  }
  el.setRangeText(text, from, to, 'end');
  onChange(el.value);
}

/**
 * A text field of Markdown with a toolbar: the switch of the display (`Plain` by default, `MD`
 * unlocks the markup buttons and the preview). Formatted text pasted into it (a page, a
 * document) becomes Markdown; plain text, including Markdown, is pasted as it is.
 */
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
  const [mode, setMode] = useState<Mode>('plain');
  const [preview, setPreview] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation();
  const markdown = mode === 'markdown';

  function changeMode(next: string): void {
    if (next !== 'plain' && next !== 'markdown') return;
    setMode(next);
    if (next === 'plain') setPreview(false);
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (html === '') return;
    const md = htmlToMarkdown(html);
    if (md === null) return;
    event.preventDefault();
    const el = event.currentTarget;
    const from = el.selectionStart;
    replaceRange(el, from, el.selectionEnd, md, onChange);
    el.setSelectionRange(from + md.length, from + md.length);
  }

  function mark(action: MarkupAction): void {
    const el = area.current;
    if (el === null) return;
    const edit = applyMarkup(el.value, el.selectionStart, el.selectionEnd, action);
    replaceRange(el, edit.from, edit.to, edit.text, onChange);
    el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  }

  const height = `${Math.max(rows, 2) * 1.25 + 0.75}rem`;
  const editing = markdown && !preview && !disabled;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', grow && 'flex-1')}>
      <MarkupToolbar
        mode={mode}
        onMode={changeMode}
        editing={editing}
        preview={preview}
        onPreview={() => setPreview(!preview)}
        onMark={mark}
      />
      <Textarea
        ref={area}
        id={id}
        aria-label={label}
        rows={rows}
        className={grow ? 'flex-1' : undefined}
        style={grow ? { minHeight: height } : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        hidden={preview}
        onPaste={paste}
        onChange={(event) => onChange(event.target.value)}
      />
      {preview ? (
        <div
          className="overflow-auto rounded-md border bg-card px-2.5 py-1.5"
          style={{ minHeight: height }}
        >
          {value.trim() === '' ? (
            <p className="text-sm text-muted-foreground">{t('queue.form.previewEmpty')}</p>
          ) : (
            <Markdown text={value} />
          )}
        </div>
      ) : null}
    </div>
  );
}
