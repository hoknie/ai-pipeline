/**
 * Таблицы проверок раскладки: граф фич, виды папок, пакеты, пределы размера. Новое правило о
 * размещении кода приходит сюда вместе с проверкой.
 */

/**
 * Старые слои `src`. Значение — слои и подпути, которые слою разрешено импортировать (кроме себя).
 * Слой исчезает из таблицы вместе с папкой; подпуть вроде `platform/errors` разрешает только его.
 */
export const oldLayers: Record<string, string[]> = {
  platform: [],
  // `src/cli/main.ts`: the entry point only calls the CLI.
  cli: ['presentation/cli'],
};

/** Старые слои, которые видит `app`: он собирает приложение из них. */
export const appOldLayers: readonly string[] = [];

/** Виды папок фичи. */
export const featureViews = [
  'types',
  'machine',
  'ports',
  'services',
  'usecases',
  'repositories',
  'clients',
] as const;
export type FeatureView = (typeof featureViews)[number];

/** Чистые виды: не тянут `node:*` и внешние пакеты даже косвенно. */
export const pureViews: readonly string[] = ['types', 'machine'];

/** Какие виды своей фичи может импортировать каждый вид. */
export const ownViews: Record<FeatureView, readonly FeatureView[]> = {
  types: ['types'],
  machine: ['types', 'machine'],
  ports: ['types', 'ports'],
  repositories: ['types', 'ports', 'repositories'],
  usecases: ['types', 'ports', 'repositories', 'machine', 'usecases'],
  services: ['types', 'ports', 'repositories', 'machine', 'usecases', 'services'],
  clients: ['types', 'ports', 'services', 'clients'],
};

/** Какие виды чужой фичи (по стрелке графа) может импортировать каждый вид. */
export const foreignViews: Record<FeatureView, readonly FeatureView[]> = {
  types: ['types'],
  machine: ['types'],
  ports: ['types'],
  repositories: ['types'],
  usecases: ['types', 'services'],
  services: ['types', 'services'],
  clients: ['types', 'services'],
};

/** Виды, разрешённые фиче `compose`: только сервисы. */
export const composeViews: readonly FeatureView[] = ['services'];

/** Граф фич: ключ видит перечисленные фичи. Ацикличен. */
export const featureGraph: Record<string, readonly string[]> = {
  'swarm-config': [],
  repos: [],
  agents: ['swarm-config'],
  tags: ['repos'],
  runs: ['agents', 'repos', 'swarm-config'],
  'swarm-edit': ['agents', 'repos', 'runs', 'swarm-config'],
  artifacts: ['runs'],
  delivery: ['runs', 'swarm-config'],
  processes: ['runs'],
  queue: ['runs', 'tags', 'repos', 'swarm-config'],
  observers: ['queue', 'runs', 'repos', 'swarm-config'],
  compose: ['observers', 'queue', 'runs', 'repos'],
};

/** Подслои представления. */
export type PresentationSub =
  'ipc/contract' | 'ipc/client' | 'ipc/views' | 'ipc' | 'format' | 'web' | 'mcp' | 'cli';

export const presentationSubs: readonly string[] = [
  'ipc/contract',
  'ipc/client',
  'ipc/views',
  'ipc',
  'format',
  'web',
  'mcp',
  'cli',
];

interface PresentationRule {
  /** Подслои представления, которые разрешено импортировать (кроме запрещённых внутри ipc). */
  presentation: readonly string[];
  /** Виды фич, доступные подслою. */
  views: readonly FeatureView[];
  platform: boolean;
  app: boolean;
  /** Фичи, чьи `services` доступны, если `services` нет в `views`. */
  serviceFeatures?: readonly string[];
}

const daemonClients: PresentationRule = {
  presentation: ['web', 'ipc/contract', 'ipc/client'],
  views: ['types'],
  platform: true,
  app: false,
};

export const presentationRules: Record<PresentationSub, PresentationRule> = {
  'ipc/contract': { presentation: ['ipc/contract'], views: ['types'], platform: true, app: false },
  'ipc/client': {
    presentation: ['ipc/client', 'ipc/contract'],
    views: ['types'],
    platform: true,
    app: false,
  },
  ipc: {
    presentation: ['ipc', 'ipc/views', 'ipc/contract'],
    views: ['types', 'services', 'ports'],
    platform: true,
    app: false,
  },
  'ipc/views': {
    presentation: ['ipc', 'ipc/views', 'ipc/contract'],
    views: ['types', 'services', 'ports'],
    platform: true,
    app: false,
  },
  format: {
    presentation: ['format', 'ipc/contract'],
    views: ['types'],
    platform: false,
    app: false,
  },
  web: { ...daemonClients, presentation: ['web', 'ipc/contract', 'ipc/client'] },
  mcp: {
    ...daemonClients,
    presentation: ['mcp', 'format', 'ipc/contract', 'ipc/client'],
  },
  cli: {
    ...daemonClients,
    presentation: ['cli', 'mcp', 'web', 'format', 'ipc/contract', 'ipc/client'],
    app: true,
    serviceFeatures: ['swarm-config'],
  },
};

/** Подслои, в которые `cli` входит только через их `index.ts`. */
export const entryOnlySubs: readonly string[] = ['mcp', 'web'];

/** Что `app` видит в фичах и в представлении. */
export const appViews: readonly FeatureView[] = ['types', 'ports', 'services', 'clients'];
export const appPresentation: readonly string[] = [
  'ipc',
  'ipc/views',
  'ipc/contract',
  'ipc/client',
];

/**
 * Где разрешён внешний пакет. Элемент — начало пути от корня `src`; `*` заменяет один сегмент.
 * Старые папки стоят рядом с целевыми и уходят вместе со слоем.
 */
export const packagePlaces: Record<string, readonly string[]> = {
  zod: ['presentation', 'feature/*/clients'],
  yaml: ['feature/swarm-config', 'feature/swarm-edit', 'feature/agents', 'presentation/cli'],
  commander: ['presentation/cli'],
  '@modelcontextprotocol/sdk': ['presentation/mcp', 'presentation/cli'],
};

/** Классы, чьё создание через `new` допустимо только в `app` и `<фича>/services/create.ts`. */
export const assemblyClassPattern = /(Services?|Repository|Client|UseCase)$/;

/** Слои, где проверяется `new` сборочных классов: старый код с `new` не трогаем. */
export const assemblyCheckedTops: readonly string[] = ['feature', 'presentation', 'platform'];

/** Где читают `process.env` (пути от корня `src`). */
export const environmentPlaces: readonly string[] = ['cli/main.ts', 'app', 'platform'];

/** Файлы, чистота которых проверяется, помимо видов `types/` и `machine/` фич. */
export const purePaths: readonly string[] = ['platform/errors'];

export const sizeLimits = { file: 300, function: 80, folder: 12, classMethods: 12 };

/** Пути от корня, которым пределы размера не нужны: словари интерфейса. */
export const sizeExempt: readonly string[] = ['shared/i18n/locales'];

/** Области `shared` панели (`web/src/shared/<область>`). */
export const webSharedAreas: readonly string[] = ['api', 'ui', 'lib', 'i18n'];

/** Группы дизайн-системы: файл `shared/ui` лежит в одной из них. */
export const webUiGroups: readonly string[] = ['forms', 'feedback', 'layout', 'overlays'];

/** Граф областей панели: ключ видит перечисленные области (только через их `index.ts`). Ацикличен. */
export const webGraph: Record<string, readonly string[]> = {
  topology: [],
  tags: [],
  repositories: [],
  specialists: ['tags', 'repositories'],
  pipelines: ['specialists', 'topology', 'repositories'],
  runs: ['pipelines', 'tags', 'repositories'],
  queue: ['runs', 'tags', 'repositories'],
  settings: ['specialists', 'pipelines', 'repositories'],
};

/**
 * Что панель берёт из `src/` (пути от корня `src`; `*` заменяет один сегмент) и только как
 * `import type`. Пока контракт лежит в `protocol/`, его вход `protocol/index.ts` стоит рядом с
 * целевым `presentation/ipc/contract/index.ts`.
 */
export const webSrcPlaces: readonly string[] = [
  'presentation/ipc/contract/index.ts',
  'protocol/index.ts',
  'feature/*/types/index.ts',
];
