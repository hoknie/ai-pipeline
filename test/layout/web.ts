import { posix } from 'node:path';

import type { Tree, Violation } from './check.ts';
import { loadTree } from './check.ts';
import { webGraph, webSharedAreas, webSrcPlaces, webUiGroups } from './rules.ts';

function violation(path: string, rule: Violation['rule'], text: string, line?: number): Violation {
  const where = line === undefined ? '' : ` (line ${line})`;
  return { rule, path, size: 0, message: `${path}: ${text}${where}` };
}

type Where =
  | { kind: 'entry' }
  | { kind: 'app' }
  | { kind: 'shared'; area: string }
  | { kind: 'feature'; feature: string; rest: string[] }
  | { kind: 'unknown'; top: string };

function locate(path: string): Where {
  const parts = path.split('/');
  const top = parts[0] ?? '';
  if (top === 'app') return { kind: 'app' };
  if (top === 'shared' && parts.length > 2) return { kind: 'shared', area: parts[1] ?? '' };
  if (top === 'features' && parts.length > 2) {
    return { kind: 'feature', feature: parts[1] ?? '', rest: parts.slice(2) };
  }
  if (parts.length === 1 && /^main\.tsx?$/.test(top)) return { kind: 'entry' };
  return { kind: 'unknown', top: parts.length === 1 ? path : top };
}

const matchesSrcPlace = (path: string): boolean =>
  webSrcPlaces.some((place) => {
    const wanted = place.split('/');
    const parts = path.split('/');
    return (
      wanted.length === parts.length &&
      wanted.every((part, index) => part === '*' || part === parts[index])
    );
  });

const label = (where: Where): string =>
  where.kind === 'feature'
    ? `\`features/${where.feature}\``
    : where.kind === 'shared'
      ? `\`shared/${where.area}\``
      : where.kind === 'unknown'
        ? `\`${where.top}\``
        : `\`${where.kind}\``;

function problemOf(source: Where, target: Where, targetPath: string): string | undefined {
  const entryOnly = (name: string): string | undefined =>
    /^(app|features\/[^/]+)\/index\.ts$/.test(targetPath)
      ? undefined
      : `import of ${name} must go through its \`index.ts\``;
  switch (source.kind) {
    case 'shared':
      return target.kind === 'shared' ? undefined : `\`shared\` must not import ${label(target)}`;
    case 'app':
      if (target.kind === 'shared' || target.kind === 'app') return undefined;
      if (target.kind === 'feature') return entryOnly(`feature \`${target.feature}\``);
      return `\`app\` must not import ${label(target)}`;
    case 'entry':
      if (target.kind === 'shared') return undefined;
      if (target.kind === 'app') return entryOnly('`app`');
      return `\`main\` must not import ${label(target)}`;
    case 'feature': {
      if (target.kind === 'shared') return undefined;
      if (target.kind !== 'feature') return `a feature must not import ${label(target)}`;
      if (target.feature === source.feature) return undefined;
      if (!webGraph[source.feature]?.includes(target.feature)) {
        return `feature \`${source.feature}\` has no arrow to \`${target.feature}\` in the graph of the panel`;
      }
      return entryOnly(`feature \`${target.feature}\``);
    }
    default:
      return undefined;
  }
}

/** Импорты панели: направления, вход в область через `index.ts`, `src/` только типами. */
export function webImportViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const [path, parsed] of tree.files) {
    const source = locate(path);
    for (const item of parsed.imports) {
      if (!item.specifier.startsWith('.') || !/\.tsx?$/.test(item.specifier)) continue;
      const joined = posix.normalize(posix.join(posix.dirname(path), item.specifier));
      if (joined.startsWith('../../src/')) {
        const inner = joined.slice('../../src/'.length);
        if (!item.typeOnly) {
          found.push(violation(path, 'imports', `value import from \`src/${inner}\``, item.line));
        } else if (!matchesSrcPlace(inner)) {
          found.push(
            violation(path, 'imports', `\`src/${inner}\` is not a contract entry`, item.line),
          );
        }
        continue;
      }
      if (joined.startsWith('..')) {
        found.push(violation(path, 'imports', `import \`${item.specifier}\` leaves the tree`));
        continue;
      }
      const target = locate(joined);
      if (target.kind === 'unknown') {
        found.push(violation(path, 'imports', `imports from unknown place ${label(target)}`));
        continue;
      }
      const problem = problemOf(source, target, joined);
      if (problem) found.push(violation(path, 'imports', problem, item.line));
    }
  }
  return found;
}

/** Расположение файлов: области, группы `shared/ui`, `index.ts` только реэкспортирует. */
export function webPlacementViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const [path, parsed] of tree.files) {
    const where = locate(path);
    if (where.kind === 'unknown') {
      found.push(
        violation(path, 'placement', 'put code into `app`, `features/<area>` or `shared/<area>`'),
      );
      continue;
    }
    if (where.kind === 'feature' && !(where.feature in webGraph)) {
      found.push(violation(path, 'placement', `unknown area \`${where.feature}\``));
    }
    if (where.kind === 'shared') {
      if (!webSharedAreas.includes(where.area)) {
        found.push(violation(path, 'placement', `unknown area \`shared/${where.area}\``));
      } else if (where.area === 'ui' && !webUiGroups.includes(path.split('/')[2] ?? '')) {
        found.push(
          violation(path, 'placement', `\`shared/ui\` has groups ${webUiGroups.join(', ')}`),
        );
      }
    }
    if (where.kind !== 'shared' && posix.basename(path) === 'index.ts' && !parsed.onlyReexports) {
      found.push(violation(path, 'placement', '`index.ts` only re-exports: it contains code'));
    }
  }
  return found;
}

/** Каждая область — с `index.ts`, граф областей панели описывает только известные области. */
export function webEntryViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  const features = new Set<string>();
  for (const path of tree.files.keys()) {
    const where = locate(path);
    if (where.kind === 'feature') features.add(where.feature);
  }
  for (const feature of features) {
    if (!tree.files.has(`features/${feature}/index.ts`)) {
      found.push(violation(`features/${feature}`, 'placement', 'the area has no `index.ts`'));
    }
  }
  return found;
}
