import { describe, expect, it } from 'vitest';

import { sizeViolations } from './check.ts';
import { makeTree } from './tree.ts';

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `const v${index} = ${index};`);

const fn = (name: string, body: number) =>
  [`export function ${name}() {`, ...lines(body).map((line) => `  ${line}`), '}'].join('\n');

function found(files: Record<string, string>, rule?: string) {
  return sizeViolations(makeTree(files)).filter((item) => !rule || item.rule === rule);
}

describe('sizeViolations', () => {
  it('limits a file to 300 lines of code', () => {
    expect(found({ 'a.ts': lines(300).join('\n') }, 'file-size')).toEqual([]);
    const over = found({ 'a.ts': lines(301).join('\n') }, 'file-size');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ path: 'a.ts', size: 301 });
  });

  it('does not count blank lines and comments', () => {
    const text = [...lines(300), '', '// note', '/* block', ' more */'].join('\n');
    expect(found({ 'a.ts': text }, 'file-size')).toEqual([]);
  });

  it('limits a function to 80 lines of code and names it', () => {
    expect(found({ 'a.ts': fn('ok', 78) }, 'function-size')).toEqual([]);
    const over = found({ 'a.ts': fn('long', 79) }, 'function-size');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ name: 'long', size: 81 });
  });

  it('sums lines of long functions with the same name, so a second one grows the size', () => {
    const one = `export const a = () => {\n${lines(80).join('\n')}\n};\n`;
    const [first] = found({ 'a.ts': one }, 'function-size');
    const two = found(
      { 'a.ts': `${one}export const b = () => {\n${lines(80).join('\n')}\n};\n` },
      'function-size',
    );
    expect(first?.name).toBe('a');
    expect(two.map((item) => item.name)).toEqual(['a', 'b']);
    const anonymous = (n: number) =>
      `export const f${n} = [1].map(() => {\n${lines(80).join('\n')}\n});\n`;
    const callbacks = found({ 'a.ts': anonymous(1) + anonymous(2) }, 'function-size');
    const single = found({ 'a.ts': anonymous(1) }, 'function-size');
    expect(callbacks[0]?.size).toBeGreaterThan(single[0]?.size ?? 0);
  });

  it('measures components in TSX', () => {
    const body = lines(79).join('\n');
    const text = `export function Panel() {\n${body}\n  return <div />;\n}\n`;
    const over = found({ 'panel.tsx': text }, 'function-size');
    expect(over[0]).toMatchObject({ name: 'Panel', size: 82 });
  });

  it('limits a folder to 12 files without index.ts', () => {
    const files = (count: number, extra: Record<string, string> = {}) => ({
      ...Object.fromEntries(Array.from({ length: count }, (_, index) => [`d/f${index}.ts`, ''])),
      ...extra,
    });
    expect(found(files(12, { 'd/index.ts': '' }), 'folder-size')).toEqual([]);
    expect(found(files(13), 'folder-size')).toMatchObject([{ path: 'd', size: 13 }]);
  });

  it('limits a class to 12 methods outside private', () => {
    const methods = (count: number, extra = '') =>
      `export class K {\n${Array.from({ length: count }, (_, index) => `  m${index}() {}`).join('\n')}\n${extra}}\n`;
    expect(found({ 'a.ts': methods(12, '  private p() {}\n') }, 'class-size')).toEqual([]);
    expect(found({ 'a.ts': methods(13) }, 'class-size')).toMatchObject([{ name: 'K', size: 13 }]);
  });

  it('does not apply the limits to interface dictionaries', () => {
    expect(found({ 'i18n/locales/ru.ts': lines(400).join('\n') })).toEqual([]);
  });
});
