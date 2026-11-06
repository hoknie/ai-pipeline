import {
  Bold,
  Code,
  Code2,
  Eye,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.ts';
import { htmlToMarkdown } from '../lib/htmlToMarkdown.ts';
import { applyMarkup, type MarkupAction } from '../lib/markdownMarkup.ts';
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '../ui/toolbar.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { Markdown } from './Markdown.tsx';

interface MarkdownFieldProps {
  id?: string;
  'aria-label': string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}

type Mode = 'plain' | 'markdown';

const ACTIONS: { action: MarkupAction; icon: LucideIcon; separated?: boolean }[] = [
  { action: 'heading', icon: Heading2 },
  { action: 'bold', icon: Bold },
  { action: 'italic', icon: Italic },
  { action: 'strike', icon: Strikethrough },
  { action: 'bulletList', icon: List, separated: true },
  { action: 'numberedList', icon: ListOrdered },
  { action: 'taskList', icon: ListChecks },
  { action: 'quote', icon: Quote },
  { action: 'code', icon: Code, separated: true },
  { action: 'codeBlock', icon: Code2 },
  { action: 'link', icon: Link },
];

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
}: MarkdownFieldProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('plain');
  const [preview, setPreview] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
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
  const caption = (action: MarkupAction) => t(`queue.form.markup.${action}`);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Toolbar aria-label={t('queue.form.markupToolbar')}>
        <ToolbarToggleGroup
          type="single"
          aria-label={t('queue.form.markupMode')}
          value={mode}
          onValueChange={changeMode}
        >
          <ToolbarToggleItem value="plain">{t('queue.form.modePlain')}</ToolbarToggleItem>
          <ToolbarToggleItem value="markdown">{t('queue.form.modeMarkdown')}</ToolbarToggleItem>
        </ToolbarToggleGroup>
        <ToolbarSeparator />
        {ACTIONS.map(({ action, icon: Icon, separated }) => (
          <span key={action} className="contents">
            {separated ? <ToolbarSeparator /> : null}
            <ToolbarButton
              aria-label={caption(action)}
              title={
                markdown
                  ? caption(action)
                  : t('queue.form.markupNeedsMd', { label: caption(action) })
              }
              disabled={!editing}
              onClick={() => mark(action)}
            >
              <Icon aria-hidden />
            </ToolbarButton>
          </span>
        ))}
        <ToolbarButton
          className={cn('ml-auto w-auto px-2', preview && 'bg-accent text-foreground')}
          aria-pressed={preview}
          title={
            markdown
              ? t('queue.form.preview')
              : t('queue.form.markupNeedsMd', { label: t('queue.form.preview') })
          }
          disabled={!markdown}
          onClick={() => setPreview(!preview)}
        >
          <Eye aria-hidden />
          {t('queue.form.preview')}
        </ToolbarButton>
      </Toolbar>
      <Textarea
        ref={area}
        id={id}
        aria-label={label}
        rows={rows}
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
