import { describe, expect, it } from 'vitest';

import { webEntryViolations, webImportViolations, webPlacementViolations } from './web.ts';
import { makeTree, stub } from './tree.ts';

/** Нарушения импортов для файла `from`, который импортирует `specifier`. */
function imports(from: string, specifier: string, extra: Record<string, string> = {}): string[] {
  const root = makeTree({
    [from]: `import { value } from '${specifier}';\nexport const x = value;\n`,
    ...extra,
  });
  return webImportViolations(root).map((item) => item.message);
}

const typed = (specifier: string): string[] => {
  const root = makeTree({
    'features/runs/a.ts': `import type { X } from '${specifier}';\nexport type Y = X;\n`,
  });
  return webImportViolations(root).map((item) => item.message);
};

describe('webImportViolations', () => {
  it('lets a feature use shared and its own files', () => {
    expect(
      imports('features/runs/a.ts', '../../shared/lib/b.ts', { 'shared/lib/b.ts': stub }),
    ).toEqual([]);
    expect(imports('features/runs/a.ts', './b.ts', { 'features/runs/b.ts': stub })).toEqual([]);
  });

  it('rejects shared that imports a feature or app', () => {
    expect(
      imports('shared/lib/a.ts', '../../features/runs/index.ts', {
        'features/runs/index.ts': stub,
      })[0],
    ).toContain('`shared` must not import');
    expect(imports('shared/lib/a.ts', '../../app/index.ts', { 'app/index.ts': stub })[0]).toContain(
      '`shared` must not import',
    );
  });

  it('rejects an import of another area that does not go through index.ts', () => {
    const extra = { 'features/tags/index.ts': stub, 'features/tags/TagPicker.tsx': stub };
    expect(imports('features/specialists/a.ts', '../tags/index.ts', extra)).toEqual([]);
    expect(imports('features/specialists/a.ts', '../tags/TagPicker.tsx', extra)[0]).toContain(
      '`index.ts`',
    );
  });

  it('rejects an arrow against the graph of areas', () => {
    const extra = { 'features/runs/index.ts': stub };
    expect(imports('features/tags/a.ts', '../runs/index.ts', extra)[0]).toContain('no arrow');
  });

  it('rejects an import of app from a feature', () => {
    expect(
      imports('features/runs/a.ts', '../../app/index.ts', { 'app/index.ts': stub })[0],
    ).toContain('must not import');
  });

  it('rejects a value import from src', () => {
    expect(imports('shared/api/a.ts', '../../../../src/protocol/index.ts')[0]).toContain(
      'value import from `src/protocol/index.ts`',
    );
  });

  it('allows a type import of the contract and of the types of a feature', () => {
    expect(typed('../../../../src/protocol/index.ts')).toEqual([]);
    expect(typed('../../../../src/presentation/ipc/contract/index.ts')).toEqual([]);
    expect(typed('../../../../src/feature/runs/types/index.ts')).toEqual([]);
  });

  it('rejects a type import of the views of ipc and of other files of src', () => {
    expect(typed('../../../../src/presentation/ipc/views/runs.ts')[0]).toContain(
      'is not a contract entry',
    );
    expect(typed('../../../../src/feature/runs/machine/index.ts')[0]).toContain(
      'is not a contract entry',
    );
  });
});

describe('webPlacementViolations', () => {
  it('accepts areas, shared groups and a re-exporting index.ts', () => {
    const root = makeTree({
      'main.tsx': stub,
      'app/App.tsx': stub,
      'features/runs/index.ts': `export { value } from './a.ts';\n`,
      'features/runs/a.ts': stub,
      'shared/ui/forms/button.tsx': stub,
      'shared/lib/b.ts': stub,
    });
    expect(webPlacementViolations(root)).toEqual([]);
  });

  it('rejects code outside the areas, unknown areas and ungrouped ui', () => {
    const root = makeTree({
      'App.tsx': stub,
      'features/weird/a.ts': stub,
      'shared/other/a.ts': stub,
      'shared/ui/button.tsx': stub,
    });
    expect(webPlacementViolations(root)).toHaveLength(4);
  });

  it('rejects code in an index.ts', () => {
    const root = makeTree({ 'features/runs/index.ts': stub });
    expect(webPlacementViolations(root)[0]?.message).toContain('only re-exports');
  });
});

describe('webEntryViolations', () => {
  it('asks for an index.ts in every area', () => {
    const root = makeTree({ 'features/runs/a.ts': stub });
    expect(webEntryViolations(root)[0]?.message).toContain('no `index.ts`');
  });
});
