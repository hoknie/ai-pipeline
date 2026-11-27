import { describe, expect, it } from 'vitest';
import { editEditorSource, parseEditorSource } from '../src/shared/lib/markdown/editorSource.ts';

function parse(markdown: string) {
  const result = parseEditorSource(markdown);
  if (!result.ok) throw result.error;
  return result.source;
}

describe('editor source snapshots', () => {
  it.each([
    '',
    '  \n\n',
    '# Header\r\n\r\n- [x] done\r\n- [ ] todo\r\n',
    '| a | b |\n| :- | -: |\n| x | y |\n',
    '~~~json\n{"a": 1}\n~~~\n\n```mermaid\ngraph TD; A-->B\n```\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```',
    '<img src=x onerror=alert(1)>\n\n:::custom\n_unknown_\n:::',
  ])('preserves an unchanged document exactly', (markdown) => {
    expect(editEditorSource(parse(markdown), new Map())).toBe(markdown);
  });

  it('only replaces the selected block and retains unusual syntax and separators', () => {
    const markdown = 'First\r\n\r\n\r\n~~~custom info\r\n raw\r\n~~~\r\n\r\nLast  \r\n';
    const source = parse(markdown);
    expect(source.blocks).toHaveLength(3);
    expect(editEditorSource(source, new Map([[0, '**First**']]))).toBe(
      markdown.replace('First', '**First**'),
    );
    expect(editEditorSource(source, new Map([[2, '']]))).toBe(
      'First\r\n\r\n\r\n~~~custom info\r\n raw\r\n~~~\r\n\r\n\r\n',
    );
  });

  it('recognizes GFM nodes without executing raw HTML', () => {
    const source = parse(
      '| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n<script>alert(1)</script>',
    );
    expect(source.blocks.map((block) => block.node.type)).toEqual(['table', 'list', 'html']);
  });

  it('rejects out-of-range block indices', () => {
    expect(() => editEditorSource(parse('x'), new Map([[1, 'y']]))).toThrow(RangeError);
    expect(() => editEditorSource(parse('x'), new Map([[-1, 'y']]))).toThrow(RangeError);
  });

  it('uses UTF-16 offsets even after astral characters', () => {
    const source = parse('😀 first\n\nsecond');
    expect(editEditorSource(source, new Map([[1, '**second**']]))).toBe('😀 first\n\n**second**');
  });
});
