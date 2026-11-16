// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyMarkup, type MarkupAction } from '../src/shared/lib/markdown/markdownMarkup.ts';

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
    expect(run('one two', 0, 3, 'bold')).toBe('**[one]** two');
    expect(run('one two', 4, 7, 'strike')).toBe('one ~~[two]~~');
    expect(run('one two', 0, 3, 'code')).toBe('`[one]` two');
  });

  it('uses _ for italic, so that it is not confused with the edge of **', () => {
    expect(run('one', 0, 3, 'italic')).toBe('_[one]_');
    expect(run('**one**', 2, 5, 'italic')).toBe('**_[one]_**');
    expect(run('**one**', 2, 5, 'bold')).toBe('[one]');
  });

  it('leaves the spaces at the edges outside', () => {
    expect(run('a  one  b', 1, 8, 'bold')).toBe('a  **[one]**  b');
  });

  it('puts the cursor between the markers without a selection', () => {
    expect(run('ab', 1, 1, 'bold')).toBe('a**|**b');
    expect(run('ab', 1, 1, 'italic')).toBe('a_|_b');
    expect(run('a **** b', 4, 4, 'bold')).toBe('a | b');
  });

  it('takes the markers off when they are outside or at the edges of the selection', () => {
    expect(run('**one** two', 2, 5, 'bold')).toBe('[one] two');
    expect(run('**one** two', 0, 7, 'bold')).toBe('[one] two');
    expect(run('~~one~~', 2, 5, 'strike')).toBe('[one]');
  });

  it('puts a code span with a long enough fence', () => {
    expect(run('a`b', 0, 3, 'code')).toBe('``[a`b]``');
    expect(run('`b', 0, 2, 'code')).toBe('`` [`b] ``');
    expect(run('``a`b``', 2, 5, 'code')).toBe('[a`b]');
    expect(run('`` `b ``', 3, 5, 'code')).toBe('[`b]');
  });

  it('makes a link from the selection, a URL or nothing', () => {
    expect(run('please see', 7, 10, 'link')).toBe('please [see]([url])');
    expect(run('', 0, 0, 'link')).toBe('[|](url)');
  });
});

describe('line markup', () => {
  it('numbers the non-empty lines of the selection and leaves the empty ones', () => {
    expect(applyMarkup('one\n\ntwo', 0, 8, 'numberedList').text).toBe('1. one\n\n2. two');
  });

  it('puts the marker after the indent and keeps the cursor at its letter', () => {
    expect(run('  point', 4, 4, 'quote')).toBe('  > po|int');
  });

  it('works on the line of the cursor without a selection and on a lone empty line', () => {
    expect(run('a\nb\nc', 3, 3, 'bulletList')).toBe('a\n- b|\nc');
    expect(run('a\nb\nc', 2, 2, 'bulletList')).toBe('a\n- |b\nc');
    expect(run('\nabc', 0, 0, 'quote')).toBe('> |\nabc');
    expect(run('', 0, 0, 'taskList')).toBe('- [ ] |');
  });

  it('does not take a line after the selection that ends with a line break', () => {
    expect(applyMarkup('a\nb\nc', 0, 4, 'quote').text).toBe('> a\n> b');
  });

  it('takes the marker off when every non-empty line has it', () => {
    expect(applyMarkup('- one\n- two', 0, 11, 'bulletList').text).toBe('one\ntwo');
    expect(applyMarkup('1. one\n\n2. two', 0, 13, 'numberedList').text).toBe('one\n\ntwo');
    expect(applyMarkup('- [x] one', 0, 0, 'taskList').text).toBe('one');
    expect(applyMarkup('> one\n> two', 0, 11, 'quote').text).toBe('one\ntwo');
    expect(applyMarkup('## Total', 0, 0, 'heading').text).toBe('Total');
  });

  it('replaces the marker of another list kind', () => {
    expect(applyMarkup('- [ ] one\n1. two', 0, 16, 'bulletList').text).toBe('- one\n- two');
    expect(applyMarkup('- one\n* two', 0, 11, 'numberedList').text).toBe('1. one\n2. two');
    expect(applyMarkup('- one\n- [x] two', 0, 15, 'taskList').text).toBe('- [ ] one\n- [ ] two');
  });

  it('puts a marker on the lines that have none when only some have it', () => {
    expect(applyMarkup('- one\ntwo', 0, 9, 'bulletList').text).toBe('- one\n- two');
  });

  it('changes the level of a heading', () => {
    expect(applyMarkup('# Total', 0, 0, 'heading').text).toBe('## Total');
    expect(applyMarkup('### Total', 0, 0, 'heading').text).toBe('## Total');
  });

  it('moves the cursor out of a replaced marker to its end', () => {
    expect(run('# Total', 1, 1, 'heading')).toBe('## |Total');
  });

  it('keeps a selection over several lines', () => {
    expect(run('a\nb', 0, 3, 'quote')).toBe('[> a\n> b]');
  });
});

describe('code block', () => {
  it('surrounds the lines of the cursor with the fence on its own lines', () => {
    expect(applyMarkup('in\nrun\nout', 4, 4, 'codeBlock').text).toBe('```\nrun\n```');
    expect(run('in\nrun\nout', 4, 4, 'codeBlock')).toBe(`in\n${FENCE}\n[run]\n${FENCE}\nout`);
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
