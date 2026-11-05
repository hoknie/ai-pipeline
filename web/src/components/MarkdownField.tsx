import { useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { htmlToMarkdown } from '../lib/htmlToMarkdown.ts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.tsx';
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

/**
 * A text field with the tabs «Text» and «Preview». Formatted text pasted into it (a page, a
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
  const [tab, setTab] = useState('text');

  function paste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (html === '') return;
    const md = htmlToMarkdown(html);
    if (md === null) return;
    event.preventDefault();
    const el = event.currentTarget;
    if (
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, md)
    ) {
      return;
    }
    el.setRangeText(md, el.selectionStart, el.selectionEnd, 'end');
    onChange(el.value);
  }

  const height = `${Math.max(rows, 2) * 1.25 + 0.75}rem`;
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-2">
      <TabsList aria-label={t('queue.form.textTabs')}>
        <TabsTrigger value="text">{t('queue.form.textTab')}</TabsTrigger>
        <TabsTrigger value="preview">{t('queue.form.previewTab')}</TabsTrigger>
      </TabsList>
      <TabsContent value="text" forceMount hidden={tab !== 'text'}>
        <Textarea
          id={id}
          aria-label={label}
          rows={rows}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onPaste={paste}
          onChange={(event) => onChange(event.target.value)}
        />
      </TabsContent>
      <TabsContent value="preview">
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
      </TabsContent>
    </Tabs>
  );
}
