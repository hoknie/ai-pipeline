// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';
import { EditorView } from 'prosemirror-view';
import { parseEditorDocument } from '../src/shared/lib/markdown/editorDocument.ts';
import { cleanup, fireEvent, markdownValue, render, screen } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MarkdownField aria-label="Body" value={value} onChange={setValue} />
      <output data-testid="draft">{value}</output>
    </>
  );
}

function paste(editor: HTMLElement, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '' },
  });
  fireEvent(editor, event);
  expect(event.defaultPrevented).toBe(true);
}

function select(editor: HTMLElement, from: number, to = from) {
  editor.focus();
  const text = editor.querySelector('p')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}

describe('visual Markdown clipboard integration', () => {
  it.each([' ', '  ', ' **middle** ', '\u00a0**middle**\u00a0'])(
    'preserves inline clipboard edges for %j and undoes once',
    (text) => {
      render(<Field initial="левоправо" />);
      const editor = screen.getByRole('textbox', { name: 'Body' });
      select(editor, 4);
      paste(editor, { 'text/plain': text });
      expect(editor.textContent).toBe(`лево${text.replaceAll('**', '')}право`);
      expect(screen.getByTestId('draft').textContent).toBe(`лево${text}право`);
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
      expect(screen.getByTestId('draft').textContent).toBe('левоправо');
    },
  );

  it.each(['    **x**', '\t**x**'])(
    'parses significant indentation in %j before inline paste',
    (text) => {
      const updates = vi.spyOn(EditorView.prototype, 'updateState');
      render(<Field />);
      const editor = screen.getByRole('textbox', { name: 'Body' });
      paste(editor, { 'text/plain': text });
      const view = updates.mock.instances[0] as EditorView;
      expect(view.state.doc.eq(parseEditorDocument(text))).toBe(true);
      expect(editor.querySelector('pre code')?.textContent).toBe('**x**');
      expect(editor.querySelector('strong')).toBeNull();
      expect(parseEditorDocument(screen.getByTestId('draft').textContent!).eq(view.state.doc)).toBe(
        true,
      );
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
      expect(view.state.doc.eq(parseEditorDocument(''))).toBe(true);
      expect(screen.getByTestId('draft').textContent).toBe('');
    },
  );

  it('preserves nonbreaking spaces in the model, draft and history', () => {
    const updates = vi.spyOn(EditorView.prototype, 'updateState');
    render(<Field />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    paste(editor, { 'text/plain': '\u00a0**x**\u00a0' });
    const view = updates.mock.instances[0] as EditorView;
    expect(view.state.doc.textContent).toBe('\u00a0x\u00a0');
    expect(view.state.doc.firstChild?.child(1).marks[0]?.type.name).toBe('strong');
    expect(screen.getByTestId('draft').textContent).toBe('\u00a0**x**\u00a0');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(view.state.doc.eq(parseEditorDocument(''))).toBe(true);
    expect(screen.getByTestId('draft').textContent).toBe('');
  });

  it('preserves relative HTML link query parameters after Markdown decoding', () => {
    render(<Field />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    paste(editor, { 'text/html': '<a href="docs/search?q=a&amp;page=2">Поиск</a>' });
    const href = editor.querySelector('a')!.getAttribute('href')!;
    expect(href).toBe('docs/search?q=a&page=2');
    expect([...new URL(href, 'https://example.test/').searchParams]).toEqual([
      ['q', 'a'],
      ['page', '2'],
    ]);
    const draft = screen.getByTestId('draft').textContent!;
    expect(parseEditorDocument(draft).firstChild?.firstChild?.marks[0]?.attrs.href).toBe(href);
  });

  it('pastes literal Markdown inside a toolbar-created code block and undoes once', () => {
    render(<Field initial="code" />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    select(editor, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Code block' }));
    paste(editor, { 'text/plain': '**x**', 'text/html': '<strong>x</strong>' });
    expect(editor.querySelector('pre code')?.textContent).toBe('code**x**');
    expect(editor.querySelector('strong')).toBeNull();
    expect(screen.getByTestId('draft').textContent).toContain('```\ncode**x**\n```');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(editor.querySelector('pre code')?.textContent).toBe('code');
    expect(markdownValue(editor)).toContain('```\ncode\n```');
  });

  it.each([
    { 'text/plain': '[guide](docs/guide.md)', 'text/html': '' },
    { 'text/html': '<a href="docs/guide.md">guide</a>', 'text/plain': '' },
  ])('pastes relative links as editable links: %j', (data) => {
    render(<Field />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    paste(editor, data);
    expect(editor.querySelector('a')?.getAttribute('href')).toBe('docs/guide.md');
    expect(markdownValue(editor)).toContain('[guide](docs/guide.md)');
  });

  it('decodes entities only once and keeps entity-like relative destinations inert', () => {
    render(<Field />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    paste(editor, { 'text/html': '<a href="javascript&amp;colon;alert(1)">guide</a>' });
    const href = editor.querySelector('a')!.getAttribute('href')!;
    expect(href).toBe('javascript&colon;alert%281%29');
    expect(new URL(href, 'https://example.test/').protocol).toBe('https:');
  });

  it('introduces raw inline syntax without replacing the editor or losing history', () => {
    render(<Field initial={'before after\r\n\r\n'} />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    select(editor, 7);
    paste(editor, { 'text/plain': '<custom>unknown</custom>' });
    expect(screen.getByRole('textbox', { name: 'Body' })).toBe(editor);
    expect(editor.querySelector('custom')).toBeNull();
    expect(editor.querySelector('[data-raw-inline]')?.textContent).toBe('<custom>');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(editor.textContent).toBe('before after');
    fireEvent.keyDown(editor, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(editor.textContent).toBe('before <custom>unknown</custom>after');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    // The source textarea normalizes CRLF for display; exact history bytes are tested separately.
    expect(markdownValue(editor)).toBe('before after\n\n');
  });

  it.each([
    [
      'Markdown',
      {
        'text/plain':
          '| Name | Value |\n| --- | --- |\n| answer | 42 |\n\n```json\n{"answer":42}\n```',
      },
    ],
    [
      'HTML',
      {
        'text/html':
          '<table><tr><th>Name</th><th>Value</th></tr><tr><td>answer</td><td>42</td></tr></table><pre><code class="language-json">{"answer":42}</code></pre>',
        'text/plain': 'unformatted fallback',
      },
    ],
  ])('pastes %s tables and language fences as visual blocks', (_kind, data) => {
    render(<Field />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    editor.focus();
    paste(editor, data as Record<string, string>);
    expect(editor.querySelectorAll('table')).toHaveLength(1);
    expect(editor.querySelectorAll('tr')).toHaveLength(2);
    expect(editor.querySelector('th')?.textContent).toBe('Name');
    expect(editor.querySelector('td')?.textContent).toBe('answer');
    expect(editor.querySelector('pre code')?.textContent).toBe('{"answer":42}');
    expect(editor.querySelector('pre .hljs-number')?.textContent).toBe('42');
    expect(document.querySelectorAll('.ProseMirror')).toHaveLength(1);
    const source = markdownValue(editor);
    expect(source).toContain('| Name | Value |');
    expect(source).toContain('```json\n{"answer":42}\n```');
    expect(source).not.toContain('unformatted fallback');
  });

  it.each([
    ['Markdown', { 'text/plain': '**middle**' }],
    ['HTML', { 'text/html': '<strong>middle</strong>', 'text/plain': 'middle' }],
  ])(
    'inserts %s in the middle without replacing surrounding text and undoes once',
    (_kind, data) => {
      const original = 'before after\n\n\n';
      render(<Field initial={original} />);
      const editor = screen.getByRole('textbox', { name: 'Body' });
      select(editor, 7);
      paste(editor, data as Record<string, string>);
      expect(editor.querySelector('p')?.textContent).toBe('before middleafter');
      expect(editor.querySelector('strong')?.textContent).toBe('middle');
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
      expect(editor.querySelector('p')?.textContent).toBe('before after');
      fireEvent.keyDown(editor, {
        key: 'Z',
        ctrlKey: true,
        shiftKey: true,
      });
      const redone = screen.getByRole('textbox', { name: 'Body' });
      expect(redone.querySelector('strong')?.textContent).toBe('middle');
      fireEvent.keyDown(redone, { key: 'z', ctrlKey: true });
      expect(markdownValue(redone)).toBe(original);
    },
  );

  it.each([
    ['ctrlKey', 'V', ''],
    ['metaKey', 'V', ''],
    ['ctrlKey', 'М', 'KeyV'],
    ['metaKey', 'М', 'KeyV'],
  ] as const)(
    'uses %s Shift+V (%s) for literal text, then resumes ordinary paste',
    (modifier, key, code) => {
      render(<Field initial="before after" />);
      const editor = screen.getByRole('textbox', { name: 'Body' });
      select(editor, 7);
      fireEvent.keyDown(editor, { key, code, shiftKey: true, [modifier]: true });
      paste(editor, { 'text/plain': '**literal**', 'text/html': '<strong>rich</strong>' });
      fireEvent.keyUp(editor, { key, code, shiftKey: true, [modifier]: true });
      expect(editor.querySelector('p')?.textContent).toBe('before **literal**after');
      expect(editor.querySelector('strong')).toBeNull();
      paste(editor, { 'text/plain': '**formatted**' });
      expect(editor.querySelector('strong')?.textContent).toBe('formatted');
      expect(markdownValue(editor)).toContain('\\*\\*literal\\*\\*');
    },
  );

  it.each([
    [
      'Markdown',
      {
        'text/plain':
          '<script>alert(1)</script>\n\n[bad](javascript:alert(1)) ![pixel](https://evil.test/pixel) <iframe src="https://evil.test"></iframe>',
      },
    ],
    [
      'HTML',
      {
        'text/html':
          '<script>alert(1)</script><p><a href="javascript:alert(1)">bad</a><img src="https://evil.test/pixel" onerror="alert(1)" alt="pixel"><iframe src="https://evil.test"></iframe><a href="data:text/html,bad">data</a></p>',
        'text/plain': 'bad pixel data',
      },
    ],
  ])('keeps dangerous %s links and resources out of the live editor DOM', (_kind, data) => {
    render(<Field />);
    const editor = screen.getByRole('textbox', { name: 'Body' });
    editor.focus();
    paste(editor, data as Record<string, string>);
    expect(editor.textContent).toContain('bad');
    expect(editor.textContent).toContain('pixel');
    expect(
      editor.querySelector('script,img:not(.ProseMirror-separator),iframe,object,embed,link,style'),
    ).toBeNull();
    expect(editor.querySelector('[src],[onerror],[onclick]')).toBeNull();
    expect(editor.querySelector('a[href^="javascript:"],a[href^="data:"]')).toBeNull();
  });
});
