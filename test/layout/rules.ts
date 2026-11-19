/**
 * Tables of the layout checks: feature graph, folder views, packages, size limits. A new rule about
 * code placement comes here together with its check.
 */

/**
 * Old `src` layers. The value is the layers and subpaths the layer may import (besides itself).
 * A layer leaves the table together with its folder; a subpath like `platform/errors` allows only that subpath.
 */
export const oldLayers: Record<string, string[]> = {
  platform: [],
  // `src/cli/main.ts`: the entry point only calls the CLI.
  cli: ['presentation/cli'],
};

/** Old layers visible to `app`: it assembles the application from them. */
export const appOldLayers: readonly string[] = [];

/** Folder views of a feature. */
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

/** Pure views: they pull in neither `node:*` nor external packages, even indirectly. */
export const pureViews: readonly string[] = ['types', 'machine'];

/** Which views of its own feature each view may import. */
export const ownViews: Record<FeatureView, readonly FeatureView[]> = {
  types: ['types'],
  machine: ['types', 'machine'],
  ports: ['types', 'ports'],
  repositories: ['types', 'ports', 'repositories'],
  usecases: ['types', 'ports', 'repositories', 'machine', 'usecases'],
  services: ['types', 'ports', 'repositories', 'machine', 'usecases', 'services'],
  clients: ['types', 'ports', 'services', 'clients'],
};

/** Which views of another feature (along a graph arrow) each view may import. */
export const foreignViews: Record<FeatureView, readonly FeatureView[]> = {
  types: ['types'],
  machine: ['types'],
  ports: ['types'],
  repositories: ['types'],
  usecases: ['types', 'services'],
  services: ['types', 'services'],
  clients: ['types', 'services'],
};

/** Views allowed to the `compose` feature: services only. */
export const composeViews: readonly FeatureView[] = ['services'];

/** Feature graph: the key sees the listed features. Acyclic. */
export const featureGraph: Record<string, readonly string[]> = {
  'swarm-config': [],
  repos: [],
  agents: ['swarm-config'],
  tags: ['repos'],
  network: ['swarm-config'],
  runs: ['agents', 'repos', 'swarm-config', 'network'],
  'swarm-edit': ['agents', 'repos', 'runs', 'swarm-config'],
  artifacts: ['runs'],
  attachments: ['runs', 'swarm-config'],
  delivery: ['runs', 'swarm-config'],
  processes: ['runs'],
  queue: ['runs', 'tags', 'repos', 'swarm-config', 'attachments'],
  observers: ['queue', 'runs', 'repos', 'swarm-config'],
  stats: ['runs', 'repos', 'swarm-config'],
  integrations: ['repos'],
  identity: ['swarm-config'],
  compose: ['observers', 'queue', 'runs', 'tags', 'repos', 'integrations'],
};

/** Presentation sublayers. */
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
  /** Presentation sublayers that may be imported (except those forbidden inside ipc). */
  presentation: readonly string[];
  /** Feature views available to the sublayer. */
  views: readonly FeatureView[];
  platform: boolean;
  app: boolean;
  /** Features whose `services` are available when `services` is not in `views`. */
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

/** Sublayers that `cli` enters only through their `index.ts`. */
export const entryOnlySubs: readonly string[] = ['mcp', 'web'];

/** What `app` sees in the features and in the presentation. */
export const appViews: readonly FeatureView[] = ['types', 'ports', 'services', 'clients'];
export const appPresentation: readonly string[] = [
  'ipc',
  'ipc/views',
  'ipc/contract',
  'ipc/client',
];

/**
 * Where an external package is allowed. An element is a path prefix from the `src` root; `*` replaces one segment.
 * Old folders sit next to the target ones and leave together with their layer.
 */
export const packagePlaces: Record<string, readonly string[]> = {
  zod: ['presentation', 'feature/*/clients'],
  yaml: ['feature/swarm-config', 'feature/swarm-edit', 'feature/agents', 'presentation/cli'],
  commander: ['presentation/cli'],
  '@modelcontextprotocol/sdk': ['presentation/mcp', 'presentation/cli'],
  'openid-client': ['feature/identity/clients'],
  ws: ['presentation/web'],
  '@node-saml/node-saml': ['feature/identity/clients'],
};

/** Classes that may be created with `new` only in `app` and `<feature>/services/create.ts`. */
export const assemblyClassPattern = /(Services?|Repository|Client|UseCase)$/;

/** Layers where `new` of assembly classes is checked: old code with `new` is left alone. */
export const assemblyCheckedTops: readonly string[] = ['feature', 'presentation', 'platform'];

/** Where `process.env` is read (paths from the `src` root). */
export const environmentPlaces: readonly string[] = ['cli/main.ts', 'app', 'platform'];

/** Files whose purity is checked, besides the `types/` and `machine/` views of features. */
export const purePaths: readonly string[] = ['platform/errors'];

export const sizeLimits = { file: 300, function: 80, folder: 12, classMethods: 12 };

/** Paths from the root that need no size limits: interface dictionaries. */
export const sizeExempt: readonly string[] = ['shared/i18n/locales'];

/** `shared` areas of the panel (`web/src/shared/<area>`). */
export const webSharedAreas: readonly string[] = ['api', 'ui', 'lib', 'i18n'];

/** Design system groups: a `shared/ui` file lies in one of them. */
export const webUiGroups: readonly string[] = ['forms', 'feedback', 'layout', 'overlays', 'charts'];

/** Graph of panel areas: the key sees the listed areas (only through their `index.ts`). Acyclic. */
export const webGraph: Record<string, readonly string[]> = {
  account: [],
  topology: [],
  stats: [],
  tags: [],
  repositories: [],
  providers: ['repositories'],
  specialists: ['tags', 'repositories', 'providers'],
  pipelines: ['specialists', 'topology', 'repositories'],
  runs: ['pipelines', 'tags', 'repositories', 'providers'],
  queue: ['runs', 'tags', 'repositories', 'providers'],
  swarm: ['providers', 'specialists', 'pipelines', 'repositories'],
  settings: ['swarm', 'specialists', 'repositories'],
};

/**
 * What the panel takes from `src/` (paths from the `src` root; `*` replaces one segment), and only as
 * `import type`. While the contract lives in `protocol/`, its entry `protocol/index.ts` sits next to
 * the target `presentation/ipc/contract/index.ts`.
 */
export const webSrcPlaces: readonly string[] = [
  'presentation/ipc/contract/index.ts',
  'protocol/index.ts',
  'feature/*/types/index.ts',
];
