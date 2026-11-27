// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseEditorDocument } from '../src/shared/lib/markdown/editorDocument.ts';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';
import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Target({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MarkdownField aria-label="Target" value={value} onChange={setValue} />
      <output>{value}</output>
    </>
  );
}

function paste(editor: HTMLElement, html: string, plain: string) {
  fireEvent.paste(editor, {
    clipboardData: { getData: (type: string) => (type === 'text/html' ? html : plain) },
  });
}

it.each([
  ['json', '{"answer":42}'],
  ['mermaid', 'graph TD\nA --> B'],
  ['plantuml', '@startuml\nAlice -> Bob: hello\n@enduml'],
])(
  'copies %s through the real EditorView clipboard serializer without nesting fences',
  (language, code) => {
    const source = `\`\`\`${language}\n${code}\n\`\`\``;
    const doc = parseEditorDocument(source);
    const from = new EditorView(document.createElement('div'), {
      state: EditorState.create({ doc }),
    });
    try {
      const clipboard = from.serializeForClipboard(doc.slice(0, doc.content.size));
      expect(clipboard.text).toBe(source);
      expect(clipboard.dom.querySelector('pre')?.textContent).toBe(source);
      render(<Target />);
      const target = screen.getByRole('textbox', { name: 'Target' });
      paste(target, clipboard.dom.innerHTML, clipboard.text);
      const draft = document.querySelector('output')!.textContent!;
      expect(draft).toBe(source);
      const copied = parseEditorDocument(draft).firstChild!;
      expect(copied.attrs.language).toBe(language);
      expect(copied.attrs.code).toBe(code);
      fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
      expect(document.querySelector('output')!.textContent).toBe('');
      // A plain-only clipboard still carries the complete Markdown block.
      paste(target, '', clipboard.text);
      expect(document.querySelector('output')!.textContent).toBe(source);
      fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(target, { key: 'V', ctrlKey: true, shiftKey: true });
      paste(target, '', clipboard.text);
      expect(target.querySelector('p')?.textContent).toBe(source);
      const literal = parseEditorDocument(document.querySelector('output')!.textContent!);
      expect(literal.textBetween(0, literal.content.size, '\n')).toBe(source);
      expect(target.querySelector('[data-raw-markdown]')).toBeNull();
      fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
      expect(document.querySelector('output')!.textContent).toBe('');
    } finally {
      from.destroy();
    }
  },
);

it('copies raw inline atoms into text/plain and pastes without HTML', () => {
  const source = 'before <custom>unknown</custom> after';
  const doc = parseEditorDocument(source);
  const from = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc }),
  });
  try {
    const clipboard = from.serializeForClipboard(doc.slice(0, doc.content.size));
    expect(clipboard.text).toBe(source);
    render(<Target />);
    const target = screen.getByRole('textbox', { name: 'Target' });
    paste(target, '', clipboard.text);
    expect(document.querySelector('output')!.textContent).toBe(source);
    expect(target.querySelector('custom')).toBeNull();
    fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
    expect(document.querySelector('output')!.textContent).toBe('');
  } finally {
    from.destroy();
  }
});

it.each([
  [' ', ' '],
  ['&nbsp;', '\u00a0'],
])('preserves %s around an HTML link label', (htmlSpace, space) => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  render(<Target />);
  const editor = screen.getByRole('textbox', { name: 'Target' });
  paste(editor, `до<a href="/guide">${htmlSpace}после${htmlSpace}</a>конца`, 'fallback');
  const view = updates.mock.instances[0] as EditorView;
  expect(view.state.doc.textContent).toBe(`до${space}после${space}конца`);
  expect(editor.querySelector('a')?.textContent).toBe('после');
  expect(editor.querySelector('a')?.getAttribute('href')).toBe('/guide');
  const draft = document.querySelector('output')!.textContent!;
  expect(draft).toBe(`до${space}[после](/guide)${space}конца`);
  expect(parseEditorDocument(draft).eq(view.state.doc)).toBe(true);
  expect(view.state.selection.from).toBe(15);
  expect(view.state.selection.empty).toBe(true);
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
  expect(document.querySelector('output')!.textContent).toBe('');
});

it.each([
  '**до** <custom>текст</custom>',
  '<custom>текст</custom>',
  '**до** <img src=x onerror=alert(1)>',
])('preserves mixed clipboard inline atoms: %s', (source) => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  const doc = parseEditorDocument(source);
  const from = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc }),
  });
  try {
    const clipboard = from.serializeForClipboard(doc.slice(0, doc.content.size));
    render(<Target />);
    const target = screen.getByRole('textbox', { name: 'Target' });
    paste(target, clipboard.dom.innerHTML, clipboard.text);
    const view = updates.mock.instances[0] as EditorView;
    const draft = document.querySelector('output')!.textContent!;
    expect(draft).toBe(source);
    expect(view.state.doc.eq(doc)).toBe(true);
    expect(parseEditorDocument(draft).eq(doc)).toBe(true);
    expect(target.querySelector('strong')?.textContent).toBe(
      source.startsWith('**') ? 'до' : undefined,
    );
    expect(target.querySelector('[data-raw-inline]')?.textContent).toBe(
      source.includes('<img') ? '<img src=x onerror=alert(1)>' : '<custom>',
    );
    expect(target.querySelector('custom,img[src],[onerror],script')).toBeNull();
    fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
    expect(document.querySelector('output')!.textContent).toBe('');
  } finally {
    from.destroy();
  }
});

it.each([
  ['&nbsp;', '\u00a0'],
  [' ', ' '],
  [' &nbsp; ', ' \u00a0 '],
])('preserves a whitespace-only HTML link label: %s', (htmlSpace, space) => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  render(<Target />);
  const target = screen.getByRole('textbox', { name: 'Target' });
  paste(target, `до<a href="/guide">${htmlSpace}</a>после`, 'fallback');
  const view = updates.mock.instances[0] as EditorView;
  expect(view.state.doc.textContent).toBe(`до${space}после`);
  expect(target.querySelector('a')?.textContent).toBe(space);
  expect(target.querySelector('a')?.getAttribute('href')).toBe('/guide');
  const draft = document.querySelector('output')!.textContent!;
  expect(parseEditorDocument(draft).eq(view.state.doc)).toBe(true);
  expect(draft).toContain(`](/guide)`);
  fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
  expect(document.querySelector('output')!.textContent).toBe('');
});

it.each([1, 2, 3, 4, 5, 6])('keeps %i literal ATX hashes in a pasted paragraph', (level) => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  render(<Target />);
  const editor = screen.getByRole('textbox', { name: 'Target' });
  const hashes = '#'.repeat(level);
  paste(editor, `<p>${hashes} Статус <b>важно</b></p>`, 'fallback');
  const view = updates.mock.instances[0] as EditorView;
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  expect(view.state.doc.textContent).toBe(`${hashes} Статус важно`);
  expect(editor.querySelector('strong')?.textContent).toBe('важно');
  expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
  expect(view.state.selection.empty).toBe(true);
  expect(
    parseEditorDocument(document.querySelector('output')!.textContent!).eq(view.state.doc),
  ).toBe(true);
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
  expect(document.querySelector('output')!.textContent).toBe('');
  paste(editor, `<h${level}>Статус <b>важно</b></h${level}>`, 'fallback');
  expect(view.state.doc.firstChild?.type.name).toBe('heading');
  expect(view.state.doc.firstChild?.attrs.level).toBe(level);
  expect(view.state.doc.textContent).toBe('Статус важно');
});

it.each([
  ['&nbsp;', '\u00a0'],
  [' ', ' '],
])('preserves HTML %s at both inline edges, the caret, draft and undo', (htmlSpace, space) => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  render(<Target initial="левоправо" />);
  const editor = screen.getByRole('textbox', { name: 'Target' });
  editor.focus();
  const range = document.createRange();
  range.setStart(editor.querySelector('p')!.firstChild!, 4);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  paste(editor, `<strong>${htmlSpace}слово${htmlSpace}</strong>`, `${space}слово${space}`);
  const view = updates.mock.instances[0] as EditorView;
  expect(view.state.doc.textContent).toBe(`лево${space}слово${space}право`);
  expect(editor.querySelector('strong')?.textContent).toBe('слово');
  expect(view.state.selection.from).toBe(12);
  expect(view.state.selection.empty).toBe(true);
  expect(document.querySelector('output')!.textContent).toBe(`лево${space}**слово**${space}право`);
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
  expect(document.querySelector('output')!.textContent).toBe('левоправо');
});

it.each([
  ['~~готово~~', '~~готово~~', false],
  ['<del>готово</del>', 'готово', true],
])('preserves literal versus semantic GFM strike in HTML: %s', (html, text, struck) => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  render(<Target />);
  const editor = screen.getByRole('textbox', { name: 'Target' });
  paste(editor, `<p><b>Статус:</b> ${html}</p>`, `Статус: ${text}`);
  const view = updates.mock.instances[0] as EditorView;
  expect(view.state.doc.textContent).toBe(`Статус: ${text}`);
  expect(Boolean(editor.querySelector('del'))).toBe(struck);
  const draft = document.querySelector('output')!.textContent!;
  expect(parseEditorDocument(draft).eq(view.state.doc)).toBe(true);
});
