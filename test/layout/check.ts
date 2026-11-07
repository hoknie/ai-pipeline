import { readdirSync, readFileSync } from 'node:fs';
import { posix, join } from 'node:path';

import {
  appPresentation,
  appViews,
  assemblyCheckedTops,
  assemblyClassPattern,
  composeViews,
  entryOnlySubs,
  environmentPlaces,
  featureGraph,
  featureViews,
  foreignViews,
  appOldLayers,
  oldLayers,
  ownViews,
  packagePlaces,
  presentationRules,
  presentationSubs,
  purePaths,
  pureViews,
  sizeExempt,
  sizeLimits,
  type FeatureView,
  type PresentationSub,
} from './rules.ts';
import { parseText, type ParsedSource } from './source.ts';

export type Rule =
  | 'imports'
  | 'graph'
  | 'packages'
  | 'placement'
  | 'purity'
  | 'direct-import'
  | 'environment'
  | 'file-size'
  | 'function-size'
  | 'folder-size'
  | 'class-size';

export interface Violation {
  rule: Rule;
  /** Путь от корня проверки, `/` вместо разделителя. */
  path: string;
  /** Функция, класс или конечный пакет цепочки, если нарушение относится к ним. */
  name?: string;
  /** Размер для правил с пределом; у остальных 0. */
  size: number;
  message: string;
}

function violation(
  rule: Rule,
  path: string,
  text: string,
  extra: { name?: string; size?: number } = {},
): Violation {
  const result: Violation = { rule, path, size: extra.size ?? 0, message: `${path}: ${text}` };
  if (extra.name !== undefined) result.name = extra.name;
  return result;
}

export interface Tree {
  root: string;
  files: Map<string, ParsedSource>;
}

function listFiles(root: string, directory = ''): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(root, path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

export function loadTree(root: string): Tree {
  const files = new Map<string, ParsedSource>();
  for (const path of listFiles(root).sort()) {
    files.set(path, parseText(path, readFileSync(join(root, path), 'utf8')));
  }
  return { root, files };
}

/** Путь импортируемого файла от корня или `undefined`, если импорт выходит за корень. */
function resolveTarget(from: string, specifier: string, tree: Tree): string | undefined {
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (joined.startsWith('..')) return undefined;
  for (const candidate of [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}/index.ts`]) {
    if (tree.files.has(candidate)) return candidate;
  }
  return joined;
}

type Where =
  | { kind: 'old'; layer: string }
  | { kind: 'app' }
  | { kind: 'platform'; sub: string }
  | { kind: 'feature'; feature: string; view: string; rest: string[] }
  | { kind: 'presentation'; sub: string }
  | { kind: 'unknown'; top: string };

const stripExtension = (name: string | undefined): string => (name ?? '').replace(/\.tsx?$/, '');

function locate(path: string): Where {
  const parts = path.split('/');
  const top = parts[0] ?? '';
  if (top === 'app') return { kind: 'app' };
  if (top === 'platform') return { kind: 'platform', sub: stripExtension(parts[1]) };
  if (top === 'feature') {
    const rest = parts.slice(3);
    // Файл прямо в корне фичи не имеет вида: `view` пуст.
    return {
      kind: 'feature',
      feature: parts[1] ?? '',
      view: parts.length > 3 ? (parts[2] ?? '') : '',
      rest: parts.length > 3 ? rest : [],
    };
  }
  if (top === 'presentation') {
    const first = stripExtension(parts[1]);
    if (first === 'ipc') {
      const second = stripExtension(parts[2]);
      const sub =
        ['contract', 'client', 'views'].includes(second) && parts.length > 2
          ? `ipc/${second}`
          : 'ipc';
      return { kind: 'presentation', sub };
    }
    return { kind: 'presentation', sub: first };
  }
  if (top in oldLayers) return { kind: 'old', layer: top };
  return { kind: 'unknown', top };
}

const isFeatureView = (view: string): view is FeatureView =>
  (featureViews as readonly string[]).includes(view);

/** Файл — вход вида: `<вид>/index.ts` (у `clients` ещё `clients/<адаптер>/index.ts`). */
function isViewEntry(target: Where & { kind: 'feature' }): boolean {
  if (target.rest.length === 1) return target.rest[0] === 'index.ts';
  return target.view === 'clients' && target.rest.length === 2 && target.rest[1] === 'index.ts';
}

function oldLayerAllows(layer: string, target: string): boolean {
  const top = target.split('/')[0] ?? '';
  if (top === layer) return true;
  return (oldLayers[layer] ?? []).some((entry) =>
    entry.includes('/')
      ? target === entry || target.startsWith(`${entry}/`) || stripExtension(target) === entry
      : entry === top,
  );
}

const label = (where: Where): string => {
  switch (where.kind) {
    case 'old':
      return `\`${where.layer}\``;
    case 'app':
      return '`app`';
    case 'platform':
      return `\`platform/${where.sub}\``;
    case 'feature':
      return `\`feature/${where.feature}/${where.view}\``;
    case 'presentation':
      return `\`presentation/${where.sub}\``;
    case 'unknown':
      return `\`${where.top}\``;
  }
};

function featureImportProblem(
  source: Where & { kind: 'feature' },
  target: Where,
  targetPath: string,
): string | undefined {
  const view = source.view;
  if (!isFeatureView(view)) return undefined; // вид без правил ловит placementViolations
  if (source.feature === 'compose' && !composeViews.includes(view)) return undefined;
  if (target.kind === 'platform') {
    const open = ['services', 'repositories', 'usecases', 'clients'].includes(view);
    if (open || (target.sub === 'errors' && (view === 'types' || view === 'machine'))) {
      return undefined;
    }
    return `view \`${view}\` must not import \`platform/${target.sub}\``;
  }
  if (target.kind !== 'feature') {
    return `feature code must not import ${label(target)}`;
  }
  if (target.feature === source.feature) {
    if (!isFeatureView(target.view) || ownViews[view].includes(target.view)) return undefined;
    return `view \`${view}\` must not import view \`${target.view}\``;
  }
  if (!featureGraph[source.feature]?.includes(target.feature)) {
    return `feature \`${source.feature}\` has no arrow to \`${target.feature}\` in the feature graph`;
  }
  if (!isFeatureView(target.view) || !foreignViews[view].includes(target.view)) {
    return `view \`${view}\` must not import view \`${target.view}\` of feature \`${target.feature}\``;
  }
  if (!isViewEntry(target)) {
    return `import of feature \`${target.feature}\` must go through \`${targetPath.split('/').slice(0, 3).join('/')}/index.ts\``;
  }
  return undefined;
}

function appImportProblem(target: Where, targetPath: string): string | undefined {
  switch (target.kind) {
    case 'app':
    case 'platform':
      return undefined;
    case 'old':
      return appOldLayers.includes(target.layer)
        ? undefined
        : `\`app\` must not import ${label(target)}`;
    case 'presentation':
      return appPresentation.includes(target.sub)
        ? undefined
        : `\`app\` must not import ${label(target)}`;
    case 'feature': {
      if (!isFeatureView(target.view) || !appViews.includes(target.view)) {
        return `\`app\` must not import ${label(target)}`;
      }
      return isViewEntry(target)
        ? undefined
        : `import of feature \`${target.feature}\` must go through \`${targetPath.split('/').slice(0, 3).join('/')}/index.ts\``;
    }
    default:
      return `\`app\` must not import ${label(target)}`;
  }
}

function presentationImportProblem(
  source: Where & { kind: 'presentation' },
  target: Where,
  targetPath: string,
): string | undefined {
  const rule = presentationRules[source.sub as PresentationSub];
  if (!rule) return `unknown presentation sublayer \`${source.sub}\``;
  switch (target.kind) {
    case 'platform':
      return rule.platform
        ? undefined
        : `\`presentation/${source.sub}\` must not import ${label(target)}`;
    case 'app':
      return rule.app ? undefined : `\`presentation/${source.sub}\` must not import \`app\``;
    case 'presentation': {
      if (!presentationSubs.includes(target.sub)) {
        return `unknown presentation sublayer \`${target.sub}\``;
      }
      if (!rule.presentation.includes(target.sub)) {
        return `\`presentation/${source.sub}\` must not import \`presentation/${target.sub}\``;
      }
      if (
        source.sub === 'cli' &&
        entryOnlySubs.includes(target.sub) &&
        !/^presentation\/[^/]+\/index\.ts$/.test(targetPath)
      ) {
        return `\`presentation/cli\` must import \`presentation/${target.sub}\` only through \`index.ts\``;
      }
      return undefined;
    }
    case 'feature': {
      const view = target.view;
      const services =
        view === 'services' && (rule.serviceFeatures?.includes(target.feature) ?? false);
      if (!isFeatureView(view) || !(rule.views.includes(view) || services)) {
        return `\`presentation/${source.sub}\` must not import ${label(target)}`;
      }
      return isViewEntry(target)
        ? undefined
        : `import of feature \`${target.feature}\` must go through \`${targetPath.split('/').slice(0, 3).join('/')}/index.ts\``;
    }
    default:
      return `\`presentation/${source.sub}\` must not import ${label(target)}`;
  }
}

export function importViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const [path, parsed] of tree.files) {
    const source = locate(path);
    if (source.kind === 'unknown') {
      found.push(violation('imports', path, `unknown layer ${label(source)}`));
      continue;
    }
    for (const item of parsed.imports) {
      if (!item.specifier.startsWith('.')) continue;
      const target = resolveTarget(path, item.specifier, tree);
      if (target === undefined) {
        found.push(
          violation('imports', path, `import \`${item.specifier}\` leaves the source tree`),
        );
        continue;
      }
      const where = locate(target);
      let problem: string | undefined;
      if (where.kind === 'unknown') problem = `imports from unknown layer ${label(where)}`;
      else if (source.kind === 'old') {
        const sameLayer = where.kind === 'old' && where.layer === source.layer;
        if (!sameLayer && !oldLayerAllows(source.layer, target)) {
          problem = `layer ${label(source)} must not import \`${target.split('/')[0]}\``;
        }
      } else if (source.kind === 'app') problem = appImportProblem(where, target);
      else if (source.kind === 'platform') {
        if (where.kind !== 'platform') problem = `\`platform\` must not import ${label(where)}`;
      } else if (source.kind === 'feature') problem = featureImportProblem(source, where, target);
      else problem = presentationImportProblem(source, where, target);
      if (problem) found.push(violation('imports', path, `${problem} (line ${item.line})`));
    }
  }
  return found;
}

/** Цикл в графе фич: последовательность имён от фичи до неё же или `undefined`. */
export function findCycle(graph: Record<string, readonly string[]>): string[] | undefined {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const walk = (name: string): string[] | undefined => {
    if (state.get(name) === 'done') return undefined;
    if (state.get(name) === 'open') return [...stack.slice(stack.indexOf(name)), name];
    state.set(name, 'open');
    stack.push(name);
    for (const next of graph[name] ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, 'done');
    return undefined;
  };
  for (const name of Object.keys(graph)) {
    const cycle = walk(name);
    if (cycle) return cycle;
  }
  return undefined;
}

export function graphViolations(
  graph: Record<string, readonly string[]> = featureGraph,
): Violation[] {
  const cycle = findCycle(graph);
  return cycle ? [violation('graph', 'feature graph', `cycle ${cycle.join(' → ')}`)] : [];
}

const packageName = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
};

const isExternal = (specifier: string): boolean =>
  !specifier.startsWith('.') && !specifier.startsWith('node:');

function matchesPlace(path: string, place: string): boolean {
  const wanted = place.split('/');
  const parts = path.split('/');
  if (parts.length < wanted.length) return false;
  return wanted.every((part, index) => {
    const actual = parts[index] ?? '';
    return part === '*' ? actual !== '' : actual === part || actual === `${part}.ts`;
  });
}

export function packageViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const [path, parsed] of tree.files) {
    const reported = new Set<string>();
    for (const item of parsed.imports) {
      if (!isExternal(item.specifier)) continue;
      const name = packageName(item.specifier);
      if (reported.has(name)) continue;
      const places = packagePlaces[name] ?? [];
      if (places.some((place) => matchesPlace(path, place))) continue;
      reported.add(name);
      const allowed =
        places.length > 0 ? `allowed only in ${places.join(', ')}` : 'not in the package table';
      found.push(violation('packages', path, `package \`${name}\` ${allowed} (line ${item.line})`));
    }
  }
  return found;
}

function pureEntry(path: string): boolean {
  const where = locate(path);
  if (where.kind === 'feature') return pureViews.includes(where.view);
  return purePaths.some((place) => matchesPlace(path, place));
}

/** Кратчайшая цепочка выполняемых импортов от файла до внешнего пакета или `node:*`. */
function impureChains(entry: string, tree: Tree): { terminal: string; chain: string[] }[] {
  const found = new Map<string, string[]>();
  const seen = new Set<string>([entry]);
  const queue: string[][] = [[entry]];
  while (queue.length > 0) {
    const chain = queue.shift() ?? [];
    const file = chain[chain.length - 1] ?? '';
    for (const item of tree.files.get(file)?.imports ?? []) {
      if (item.typeOnly) continue;
      if (!item.specifier.startsWith('.')) {
        if (!found.has(item.specifier)) found.set(item.specifier, [...chain, item.specifier]);
        continue;
      }
      const target = resolveTarget(file, item.specifier, tree);
      if (target === undefined || seen.has(target) || !tree.files.has(target)) continue;
      seen.add(target);
      queue.push([...chain, target]);
    }
  }
  return [...found].map(([terminal, chain]) => ({ terminal, chain }));
}

export function purityViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const path of tree.files.keys()) {
    if (!pureEntry(path)) continue;
    for (const item of tree.files.get(path)?.imports ?? []) {
      if (item.typeOnly || item.specifier.startsWith('.')) continue;
      found.push(
        violation(
          'direct-import',
          path,
          `pure file imports \`${item.specifier}\` directly (line ${item.line})`,
        ),
      );
    }
    // Одно нарушение на конечную зависимость: подмена зависимости меняет ключ записи.
    const chains = impureChains(path, tree).sort((x, y) => x.terminal.localeCompare(y.terminal));
    for (const item of chains) {
      found.push(
        violation(
          'purity',
          path,
          `pure file depends on \`${item.terminal}\`: ${item.chain.join(' → ')}`,
          { name: item.terminal, size: 1 },
        ),
      );
    }
  }
  return found;
}

export function environmentViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const [path, parsed] of tree.files) {
    if (parsed.processEnv === 0) continue;
    if (environmentPlaces.some((place) => matchesPlace(path, place))) continue;
    found.push(
      violation(
        'environment',
        path,
        `\`process.env\` is read outside the entry point, \`app\` and \`platform\``,
        {
          size: parsed.processEnv,
        },
      ),
    );
  }
  return found;
}

export function placementViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  for (const [path, parsed] of tree.files) {
    const where = locate(path);
    if (where.kind === 'feature') {
      if (where.view === '') {
        found.push(
          violation(
            'placement',
            path,
            'a feature has no `.ts` files in its root: put code into a view folder',
          ),
        );
        continue;
      }
      if (!isFeatureView(where.view)) {
        found.push(
          violation(
            'placement',
            path,
            `unknown view \`${where.view}\`: use ${featureViews.join(', ')}`,
          ),
        );
        continue;
      }
      if (where.view === 'machine' && where.feature !== 'runs') {
        found.push(violation('placement', path, '`machine` exists only in feature `runs`'));
      }
      if (where.feature === 'compose' && !composeViews.includes(where.view)) {
        found.push(violation('placement', path, 'feature `compose` has only `services`'));
      }
    }
    if (
      (where.kind === 'feature' || where.kind === 'presentation' || where.kind === 'platform') &&
      posix.basename(path) === 'index.ts' &&
      !parsed.onlyReexports
    ) {
      found.push(violation('placement', path, '`index.ts` only re-exports: it contains code'));
    }
    const top = path.split('/')[0] ?? '';
    const mayCreate =
      where.kind === 'feature' && where.view === 'services' && where.rest.join('/') === 'create.ts';
    if (assemblyCheckedTops.includes(top) && !mayCreate) {
      for (const item of parsed.created) {
        if (assemblyClassPattern.test(item.name)) {
          found.push(
            violation(
              'placement',
              path,
              `\`new ${item.name}\` outside \`app\` and \`services/create.ts\` (line ${item.line})`,
            ),
          );
        }
      }
    }
  }
  return found;
}

const exempt = (path: string): boolean =>
  sizeExempt.some((place) => path === place || path.startsWith(`${place}/`));

export function sizeViolations(root: string, tree: Tree = loadTree(root)): Violation[] {
  const found: Violation[] = [];
  const perFolder = new Map<string, number>();
  for (const [path, parsed] of tree.files) {
    if (exempt(path)) continue;
    const folder = posix.dirname(path);
    if (posix.basename(path) !== 'index.ts')
      perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
    if (parsed.codeLines > sizeLimits.file) {
      found.push(
        violation(
          'file-size',
          path,
          `${parsed.codeLines} lines of code, limit ${sizeLimits.file}`,
          {
            size: parsed.codeLines,
          },
        ),
      );
    }
    // Размер записи — сумма строк всех превышающих функций с этим именем: вторая такая функция его увеличивает.
    const biggest = new Map<string, number>();
    for (const item of parsed.functions) {
      if (item.lines > sizeLimits.function) {
        biggest.set(item.name, (biggest.get(item.name) ?? 0) + item.lines);
      }
    }
    for (const [name, lines] of biggest) {
      found.push(
        violation(
          'function-size',
          path,
          `function \`${name}\` has ${lines} lines of code (sum over all functions with this name over the limit), limit ${sizeLimits.function} each`,
          {
            name,
            size: lines,
          },
        ),
      );
    }
    for (const item of parsed.classes) {
      if (item.methods > sizeLimits.classMethods) {
        found.push(
          violation(
            'class-size',
            path,
            `class \`${item.name}\` has ${item.methods} methods outside private, limit ${sizeLimits.classMethods}`,
            {
              name: item.name,
              size: item.methods,
            },
          ),
        );
      }
    }
  }
  for (const [folder, count] of perFolder) {
    if (count > sizeLimits.folder) {
      found.push(
        violation(
          'folder-size',
          folder,
          `${count} files without index.ts, limit ${sizeLimits.folder}`,
          {
            size: count,
          },
        ),
      );
    }
  }
  return found;
}
