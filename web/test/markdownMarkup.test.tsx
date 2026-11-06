// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyMarkup, type MarkupAction } from '../src/lib/markdownMarkup.ts';

/** Applies the edit to the text and returns the text and the selected part (`|` marks a cursor). */
function run(value: string, start: number, end: number, action: MarkupAction): string {
  const edit = applyMarkup(value, start, end, action);
  const text = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  const before = text.slice(0, edit.selectionStart);
  const selected = text.slice(edit.selectionStart, edit.selectionEnd);
  const after = text.slice(edit.selectionEnd);
  return selected === '' ? `${before}|${after}` : `${before}[${selected}]${after}`;
}

const FENCE = '```';

describe('inline markup', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(run('раз два', 0, 3, 'bold')).toBe('**[раз]** два');
    expect(run('раз два', 4, 7, 'strike')).toBe('раз ~~[два]~~');
    expect(run('раз два', 0, 3, 'code')).toBe('`[раз]` два');
  });

  it('uses _ for italic, so that it is not confused with the edge of **', () => {
    expect(run('раз', 0, 3, 'italic')).toBe('_[раз]_');
    expect(run('**раз**', 2, 5, 'italic')).toBe('**_[раз]_**');
    expect(run('**раз**', 2, 5, 'bold')).toBe('[раз]');
  });

  it('leaves the spaces at the edges outside', () => {
    expect(run('а  раз  б', 1, 8, 'bold')).toBe('а  **[раз]**  б');
  });

  it('puts the cursor between the markers without a selection', () => {
    expect(run('ab', 1, 1, 'bold')).toBe('a**|**b');
    expect(run('ab', 1, 1, 'italic')).toBe('a_|_b');
    expect(run('a **** b', 4, 4, 'bold')).toBe('a | b');
  });

  it('takes the markers off when they are outside or at the edges of the selection', () => {
    expect(run('**раз** два', 2, 5, 'bold')).toBe('[раз] два');
    expect(run('**раз** два', 0, 7, 'bold')).toBe('[раз] два');
    expect(run('~~раз~~', 2, 5, 'strike')).toBe('[раз]');
  });

  it('puts a code span with a long enough fence', () => {
    expect(run('a`b', 0, 3, 'code')).toBe('``[a`b]``');
    expect(run('`b', 0, 2, 'code')).toBe('`` [`b] ``');
    expect(run('``a`b``', 2, 5, 'code')).toBe('[a`b]');
    expect(run('`` `b ``', 3, 5, 'code')).toBe('[`b]');
  });

  it('makes a link from the selection, a URL or nothing', () => {
    expect(run('смотри тут', 7, 10, 'link')).toBe('смотри [тут]([url])');
    expect(run('', 0, 0, 'link')).toBe('[|](url)');
  });
});

describe('line markup', () => {
  it('numbers the non-empty lines of the selection and leaves the empty ones', () => {
    expect(applyMarkup('раз\n\nдва', 0, 8, 'numberedList').text).toBe('1. раз\n\n2. два');
  });

  it('puts the marker after the indent and keeps the cursor at its letter', () => {
    expect(run('  пункт', 4, 4, 'quote')).toBe('  > пу|нкт');
  });

  it('works on the line of the cursor without a selection and on a lone empty line', () => {
    expect(run('а\nб\nв', 3, 3, 'bulletList')).toBe('а\n- б|\nв');
    expect(run('а\nб\nв', 2, 2, 'bulletList')).toBe('а\n- |б\nв');
    expect(run('\nабв', 0, 0, 'quote')).toBe('> |\nабв');
    expect(run('', 0, 0, 'taskList')).toBe('- [ ] |');
  });

  it('does not take a line after the selection that ends with a line break', () => {
    expect(applyMarkup('а\nб\nв', 0, 4, 'quote').text).toBe('> а\n> б');
  });

  it('takes the marker off when every non-empty line has it', () => {
    expect(applyMarkup('- раз\n- два', 0, 11, 'bulletList').text).toBe('раз\nдва');
    expect(applyMarkup('1. раз\n\n2. два', 0, 13, 'numberedList').text).toBe('раз\n\nдва');
    expect(applyMarkup('- [x] раз', 0, 0, 'taskList').text).toBe('раз');
    expect(applyMarkup('> раз\n> два', 0, 11, 'quote').text).toBe('раз\nдва');
    expect(applyMarkup('## Итог', 0, 0, 'heading').text).toBe('Итог');
  });

  it('replaces the marker of another list kind', () => {
    expect(applyMarkup('- [ ] раз\n1. два', 0, 16, 'bulletList').text).toBe('- раз\n- два');
    expect(applyMarkup('- раз\n* два', 0, 11, 'numberedList').text).toBe('1. раз\n2. два');
    expect(applyMarkup('- раз\n- [x] два', 0, 15, 'taskList').text).toBe('- [ ] раз\n- [ ] два');
  });

  it('puts a marker on the lines that have none when only some have it', () => {
    expect(applyMarkup('- раз\nдва', 0, 9, 'bulletList').text).toBe('- раз\n- два');
  });

  it('changes the level of a heading', () => {
    expect(applyMarkup('# Итог', 0, 0, 'heading').text).toBe('## Итог');
    expect(applyMarkup('### Итог', 0, 0, 'heading').text).toBe('## Итог');
  });

  it('moves the cursor out of a replaced marker to its end', () => {
    expect(run('# Итог', 1, 1, 'heading')).toBe('## |Итог');
  });

  it('keeps a selection over several lines', () => {
    expect(run('а\nб', 0, 3, 'quote')).toBe('[> а\n> б]');
  });
});

describe('code block', () => {
  it('surrounds the lines of the cursor with the fence on its own lines', () => {
    expect(applyMarkup('до\nкод\nпосле', 4, 4, 'codeBlock').text).toBe('```\nкод\n```');
    expect(run('до\nкод\nпосле', 4, 4, 'codeBlock')).toBe(`до\n${FENCE}\n[код]\n${FENCE}\nпосле`);
  });

  it('inserts an empty block with the cursor on the empty line', () => {
    expect(run('', 0, 0, 'codeBlock')).toBe(`${FENCE}\n|\n${FENCE}`);
  });

  it('makes the fence longer than any inside', () => {
    expect(applyMarkup(`${FENCE}\nx\n${FENCE}`, 0, 11, 'codeBlock').text.split('\n')[0]).toBe(
      '````',
    );
  });
});
