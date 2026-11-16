import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  environmentViolations,
  graphViolations,
  importViolations,
  loadTree,
  packageViolations,
  placementViolations,
  purityViolations,
  sizeViolations,
  type Violation,
} from './layout/check.ts';
import { exceptions } from './layout/exceptions.ts';
import { webEntryViolations, webImportViolations, webPlacementViolations } from './layout/web.ts';
import { reconcile } from './layout/reconcile.ts';

const repository = join(import.meta.dirname, '..');

// Check root and the path for messages and the exception list.
const roots = [
  { directory: join(repository, 'src'), prefix: 'src' },
  { directory: join(repository, 'web', 'src'), prefix: 'web/src' },
];

function collect(prefix: string): Violation[] {
  const found: Violation[] = prefix === 'src' ? [...graphViolations()] : [];
  for (const { directory, prefix: current } of roots.filter((root) => root.prefix === prefix)) {
    const prefix = current;
    const tree = loadTree(directory);
    // The panel is a separate tree with its own import and placement rules; its exception list
    // is empty.
    const checks =
      prefix === 'src'
        ? [
            importViolations,
            packageViolations,
            placementViolations,
            purityViolations,
            environmentViolations,
            sizeViolations,
          ]
        : [webImportViolations, webPlacementViolations, webEntryViolations, sizeViolations];
    for (const check of checks) {
      for (const item of check(directory, tree)) {
        found.push({
          ...item,
          path: `${prefix}/${item.path}`.replace(/\/\.$/, ''),
          message: `${prefix}/${item.message}`,
        });
      }
    }
  }
  return found;
}

describe('architecture', () => {
  for (const { prefix } of roots) {
    it(`keeps the layout rules of ${prefix}, and its exception list only shrinks`, () => {
      const own = exceptions.filter(
        (entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`),
      );
      expect(reconcile(collect(prefix), own)).toEqual([]);
    });
  }
});
