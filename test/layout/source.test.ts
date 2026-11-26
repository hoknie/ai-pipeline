import { describe, expect, it } from 'vitest';

import { codeLines, parseText } from './source.ts';

const imports = (text: string, file = 'a.ts') =>
  parseText(file, text).imports.map(({ specifier, typeOnly, dynamic, reexport }) => ({
    specifier,
    typeOnly,
    dynamic,
    reexport,
  }));

describe('parseSource', () => {
  it('separates executable imports from type imports', () => {
    expect(
      imports(
        [
          `import { a } from './a.ts';`,
          `import type { B } from './b.ts';`,
          `import { type C, type D } from './c.ts';`,
          `import { type E, f } from './e.ts';`,
          `import './side.ts';`,
        ].join('\n'),
      ),
    ).toEqual([
      { specifier: './a.ts', typeOnly: false, dynamic: false, reexport: false },
      { specifier: './b.ts', typeOnly: true, dynamic: false, reexport: false },
      { specifier: './c.ts', typeOnly: true, dynamic: false, reexport: false },
      { specifier: './e.ts', typeOnly: false, dynamic: false, reexport: false },
      { specifier: './side.ts', typeOnly: false, dynamic: false, reexport: false },
    ]);
  });

  it('reads re-exports and dynamic imports', () => {
    expect(
      imports(
        [
          `export * from './all.ts';`,
          `export { x } from './x.ts';`,
          `export type { Y } from './y.ts';`,
          `export const z = () => import('./lazy.ts');`,
          `const text = "import('./not-an-import.ts')";`,
        ].join('\n'),
      ),
    ).toEqual([
      { specifier: './all.ts', typeOnly: false, dynamic: false, reexport: true },
      { specifier: './x.ts', typeOnly: false, dynamic: false, reexport: true },
      { specifier: './y.ts', typeOnly: true, dynamic: false, reexport: true },
      { specifier: './lazy.ts', typeOnly: false, dynamic: true, reexport: false },
    ]);
  });

  it('ignores import-like text in template strings and comments', () => {
    const text = [
      '// import { a } from "./comment.ts";',
      '/* import("./block.ts") */',
      'export const text = `',
      "import { b } from './template.ts';",
      '`;',
    ].join('\n');
    expect(imports(text)).toEqual([]);
  });

  it('parses TSX', () => {
    const text = [
      `import { useState } from 'react';`,
      `import type { Props } from './props.ts';`,
      `export function Panel(props: Props) {`,
      `  const [open] = useState(false);`,
      `  return <div>{open ? props.title : null}</div>;`,
      `}`,
    ].join('\n');
    const parsed = parseText('panel.tsx', text);
    expect(parsed.imports.map((item) => [item.specifier, item.typeOnly])).toEqual([
      ['react', false],
      ['./props.ts', true],
    ]);
    expect(parsed.functions).toContainEqual({ name: 'Panel', line: 3, lines: 4 });
  });

  it('visits nested type annotations, computed keys and JSX expressions', () => {
    const parsed = parseText(
      'panel.tsx',
      [
        `type Props = import('./props.ts').Props;`,
        `const panel = { [process.env.KEY]: () => <div>{new PanelService()}</div> };`,
      ].join('\n'),
    );
    expect(parsed.imports).toEqual([
      { specifier: './props.ts', typeOnly: true, dynamic: false, reexport: false, line: 1 },
    ]);
    expect(parsed.processEnv).toBe(1);
    expect(parsed.created).toEqual([{ name: 'PanelService', line: 2 }]);
    expect(parsed.functions).toHaveLength(1);
  });

  it('preserves code lines and positions around multiple comments and comment-like strings', () => {
    const text = [
      '/* first *//* second */',
      'import { value } from "./value.ts"; // trailing',
      'const text = "/* not a comment */ // still text";',
      '/* block',
      '   comment */ export const outer = () => {',
      '  // inside',
      '  const inner = () => new StoreService(); /* inline */',
      '  return inner();',
      '};',
    ].join('\n');
    const parsed = parseText('a.ts', text);
    expect(codeLines(text)).toBe(6);
    expect(parsed.codeLines).toBe(6);
    expect(parsed.imports).toEqual([
      { specifier: './value.ts', typeOnly: false, dynamic: false, reexport: false, line: 2 },
    ]);
    expect(parsed.functions).toEqual([
      { name: 'outer', line: 5, lines: 4 },
      { name: 'inner', line: 7, lines: 1 },
    ]);
    expect(parsed.created).toEqual([{ name: 'StoreService', line: 7 }]);
  });

  it('measures functions, methods and arrows in code lines', () => {
    const text = [
      'export function alpha() {',
      '  // comment',
      '',
      '  return 1;',
      '}',
      'export const beta = () => {',
      '  return 2;',
      '};',
      'export class Gamma {',
      '  run() {',
      '    return 3;',
      '  }',
      '}',
    ].join('\n');
    const byName = Object.fromEntries(
      parseText('a.ts', text).functions.map((item) => [item.name, item.lines]),
    );
    expect(byName).toEqual({ alpha: 3, beta: 3, run: 3 });
  });

  it('counts class methods outside private', () => {
    const text = [
      'class Store {',
      '  constructor() {}',
      '  a() {}',
      '  static b() {}',
      '  private c() {}',
      '  #d() {}',
      '  get e() { return 1; }',
      '}',
    ].join('\n');
    expect(parseText('a.ts', text).classes).toEqual([{ name: 'Store', line: 1, methods: 3 }]);
  });

  it('finds created classes, process.env and re-export-only files', () => {
    const code = `const a = new FooService(); const b = process.env.HOME; const c = process.env;`;
    const parsed = parseText('a.ts', code);
    expect(parsed.created).toEqual([{ name: 'FooService', line: 1 }]);
    expect(parsed.processEnv).toBe(2);
    expect(parsed.onlyReexports).toBe(false);
    expect(
      parseText('index.ts', `export { a } from './a.ts';\nexport type { B } from './b.ts';`)
        .onlyReexports,
    ).toBe(true);
    expect(parseText('index.ts', `import { a } from './a.ts';\nexport { a };`).onlyReexports).toBe(
      false,
    );
  });
});

describe('codeLines', () => {
  it('skips blank lines and comment-only lines', () => {
    const text = [
      '// one',
      '',
      'const a = 1; // trailing',
      '/*',
      ' block',
      '*/',
      'const b = `//`;',
    ].join('\n');
    expect(codeLines(text)).toBe(2);
  });

  it('counts a line with code before a block comment', () => {
    expect(codeLines('const a = 1; /* x\ny */')).toBe(1);
  });
});
