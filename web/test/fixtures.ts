import { vi } from 'vitest';

import { ApiError, type Api, type IntegrationsOverview } from '../src/shared/api/api.ts';
import type { ObserverSettings, ObserversView } from '../src/shared/api/observerTypes.ts';
import type {
  ActionEntry,
  SystemStagesResponse,
} from '../src/shared/lib/pipeline/pipelineEntries.ts';
import type { SocketLike } from '../src/shared/api/stream.ts';
import { liveTopics } from '../src/shared/api/live/topics.ts';
import type {
  BackgroundProcessView,
  ConfigCatalogResponse,
  ConfigModelsResponse,
  ConfigEditorResponse,
  EditorSetting,
  EditorSpecialist,
  EntryLevel,
  EntrySources,
  GroupRow,
  GroupView,
  ProjectLinkView,
  QueueItemView,
  QueueRunView,
  QueueView,
  RepositoryView,
  RunView,
  SystemStepRow,
  TagColor,
  TagView,
  Topology,
  Transcript,
  PipelineTopology,
  PipelinesView,
  SystemView,
  SpecialistTagFolderView,
  StatsReportView,
  DeliveryView,
  WebhookDeliveryView,
  WebhookView,
} from '../src/shared/api/types.ts';

/** The observers as the daemon sends them: off, one worker, nothing running. */
export function observersView(
  overrides: { settings?: Partial<ObserverSettings>; waiting?: number } = {},
): ObserversView {
  return {
    settings: {
      enabled: false,
      workers: 1,
      maxRepairs: 3,
      projects: [],
      specialist: {},
      ...overrides.settings,
    },
    workers: { running: [], waiting: overrides.waiting ?? 0 },
  };
}

export function topologyOf(overrides: Partial<Topology> = {}): Topology {
  const step = (id: string, specialist: string, extra: object = {}) => ({
    id,
    specialist,
    name: specialist,
    runtime: 'claude' as const,
    model: 'sonnet',
    permissions: 'edit' as const,
    onReject: null,
    groups: [],
    attempts: 0,
    rejections: 0,
    usage: null,
    skipped: false,
    ...extra,
  });
  return {
    split: null,
    steps: [
      step('plan', 'plan'),
      step('code', 'coder', {
        groups: [{ slug: 'login', title: 'Sign-in', status: 'running' }],
        attempts: 2,
        usage: { inputTokens: 10, outputTokens: 1 },
      }),
      step('review', 'reviewer', {
        onReject: { goto: 'code', maxRounds: 3 },
        attempts: 1,
        rejections: 1,
        permissions: 'read',
      }),
    ],
    merging: [],
    merged: [],
    delivery: { mode: 'worktree', resolver: null, resolverStatus: null },
    stages: [],
    ...overrides,
  };
}

export function groupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    slug: 'login',
    title: 'Sign-in',
    status: 'running',
    hold: null,
    step: 'code',
    stepName: 'Coder',
    round: 1,
    durationMs: 65_000,
    question: null,
    questions: null,
    humanOnly: null,
    reason: null,
    warnings: 0,
    delivery: 'pending',
    diff: null,
    diffRevision: null,
    limitUntil: null,
    usage: null,
    decisions: [],
    artifacts: 0,
    artifactsRevision: 0,
    wait: null,
    ...overrides,
  };
}

export function systemRow(
  kind: SystemStepRow['kind'],
  overrides: Partial<SystemStepRow> = {},
): SystemStepRow {
  const row = groupRow({ status: 'running', step: kind });
  return { ...row, kind, slug: `_${kind}`, title: `_${kind}`, ...overrides };
}

export function processView(overrides: Partial<BackgroundProcessView> = {}): BackgroundProcessView {
  return {
    pid: 4242,
    name: 'node',
    command: 'node /repo/node_modules/.bin/vite --port 5173',
    uptimeSeconds: 125,
    cpuPercent: 12,
    memoryBytes: 120 * 1024 * 1024,
    owner: {
      runId: 'run1',
      runTitle: 'First run',
      repository: '/work/app',
      group: 'login',
      groupTitle: 'Login page',
      step: 'code',
    },
    ...overrides,
  };
}

export function runView(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'run1',
    title: 'add sign-in',
    name: null,
    repository: '/repo',
    pipeline: 'feature',
    pipelineName: overrides.pipeline ?? 'feature',
    variant: 'default',
    variantName: overrides.variant ?? 'default',
    provider: null,
    providerName: null,
    author: null,
    createdBySystem: false,
    branch: 'refs/aip/run1/run',
    createdAt: 1_000,
    startedAt: 1_000,
    finishedAt: null,
    finished: false,
    state: 'active',
    waiting: 0,
    dirtyWarning: false,
    autoDeliver: false,
    deliveryMode: 'worktree',
    remoteBranch: null,
    baseCommit: 'abc',
    fromQueue: false,
    returnable: false,
    cleanedAt: null,
    cleanable: false,
    queueItem: null,
    links: [],
    linkedBy: [],
    hold: null,
    clockStoppedAt: null,
    number: 1,
    tags: [],
    counts: 'running 1',
    total: 1,
    progress: { done: 0, total: 1 },
    usage: { inputTokens: 1000, outputTokens: 100 },
    split: null,
    delivery: { applied: 0, merged: 0, failed: 0, inProgress: false, finishedAt: null },
    resolver: null,
    deliveryStage: null,
    diff: null,
    liveDiff: null,
    topology: topologyOf(),
    steps: [
      { id: 'plan', specialist: 'plan', name: 'Planner', skipped: false, state: 'done' },
      { id: 'code', specialist: 'coder', name: 'Coder', skipped: false, state: 'active' },
      { id: 'review', specialist: 'reviewer', name: 'Reviewer', skipped: false, state: 'upcoming' },
    ],
    specialists: [],
    groups: [groupRow()],
    system: [],
    attachments: [],
    pinnedSkills: [],
    decisions: [],
    ...overrides,
  };
}

export function groupView(overrides: Partial<GroupView> = {}): GroupView {
  return {
    runId: 'run1',
    slug: 'login',
    title: 'Sign-in',
    task: 'build **sign-in**',
    status: 'running',
    wait: null,
    branch: 'refs/aip/run1/groups/login',
    worktree: '/w',
    question: null,
    questions: null,
    humanOnly: null,
    reason: null,
    limitUntil: null,
    warnings: [],
    conflictFiles: [],
    delivery: {
      state: 'pending',
      reason: null,
      files: [],
      conflicts: [],
      userEdits: [],
      manual: false,
      finishedAt: null,
    },
    usage: null,
    diff: null,
    attempts: [
      {
        seq: 1,
        stepId: 'code',
        stepName: 'Coder',
        round: 1,
        specialist: 'coder',
        runtime: 'claude',
        model: 'sonnet',
        status: 'running',
        verdict: null,
        summary: null,
        feedback: null,
        decision: null,
        reason: null,
        startedAt: 1_000,
        durationMs: 5_000,
        usage: null,
        denials: [],
        outsideChanges: [],
        message: null,
        interrupting: false,
      },
    ],
    permissionHints: [],
    decisions: [],
    log: { seq: 1, lines: ['{"type":"system"}'] },
    ...overrides,
  };
}

/** A variant of a pipeline with these steps: skipped ones marked, nothing else changed. */
export function variantOf(
  steps: PipelineTopology['steps'],
  id: string,
  name: string = id,
  skip: string[] = [],
): PipelineTopology['variants'][number] {
  return {
    id,
    name,
    skip,
    steps: steps.map((step) => ({ ...step, skipped: skip.includes(step.id) })),
    split: null,
  };
}

export function pipelineOf(overrides: Partial<PipelineTopology> = {}): PipelineTopology {
  const steps =
    overrides.steps ??
    topologyOf().steps.map(
      ({ groups: _g, attempts: _a, rejections: _r, usage: _u, skipped: _s, ...step }) => step,
    );
  return {
    id: 'feature',
    name: overrides.id ?? 'feature',
    split: null,
    steps,
    delivery: { mode: 'worktree', resolver: null },
    limits: {},
    stages: [],
    variants: [variantOf(steps, 'default')],
    ...overrides,
  };
}

export function pipelinesView(overrides: Partial<PipelinesView> = {}): PipelinesView {
  return {
    repository: '/repo',
    pipelines: [pipelineOf()],
    providers: [],
    providerNames: {},
    errors: [],
    ...overrides,
  };
}

/** A catalog tag; the id follows the name unless given. */
export function tagView(
  name: string,
  color: TagColor = 'blue',
  id = `t-${name.toLowerCase()}`,
): TagView {
  return { id, repository: '/repo', name, color, task: null };
}

export function queueRun(id: string, overrides: Partial<QueueRunView> = {}): QueueRunView {
  return {
    id,
    returnable: true,
    priority: false,
    number: 1,
    title: id,
    state: 'active',
    pipeline: 'feature',
    pipelineName: overrides.pipeline ?? 'feature',
    variant: 'default',
    variantName: overrides.variant ?? 'default',
    provider: null,
    providerName: null,
    tags: [],
    createdAt: 0,
    groups: { done: 0, total: 1 },
    steps: { done: 0, total: 4, current: { step: 'plan', name: 'Planner', number: 1 } },
    active: [],
    system: [],
    delivery: null,
    waiting: [],
    delivering: false,
    problem: null,
    limitUntil: null,
    usage: null,
    ...overrides,
  };
}

export function queueOf(overrides: Partial<QueueView> = {}): QueueView {
  return {
    scope: 'project',
    repository: '/repo',
    status: 'stopped',
    parallel: 1,
    autopilot: false,
    autoAnswer: false,
    skipFailed: false,
    autoDeliver: true,
    deliveryMode: 'worktree',
    autopilotAnswer: null,
    autopilotAnswerDefault: 'I agree with your recommendations',
    onLimit: 'wait',
    filter: { pipelines: [], tags: [] },
    filterTags: [],
    stop: null,
    freezeCandidate: null,
    items: [],
    runs: [],
    skipped: [],
    updatedAt: 1,
    ...overrides,
  };
}

export function specialistEntry(
  slug: string,
  overrides: Partial<EditorSpecialist> = {},
  values: Partial<NonNullable<EditorSpecialist['effective']>> = {},
): EditorSpecialist {
  const base = {
    slug,
    level: 'project' as const,
    file: `/repo/aip/specialists/${slug}.yaml`,
    revision: `rev-${slug}`,
    raw: { name: slug.toUpperCase() },
    effective: {
      name: slug.toUpperCase(),
      runtime: 'claude',
      model: null,
      variant: null,
      reasoning_effort: null,
      permissions: 'edit',
      timeout: '30m',
      allow_commands: [],
      tools: [],
      skills: [],
      prompt: null,
      max: null,
      ...values,
    },
    shared_tags: [],
    own_tags: [],
    ...overrides,
  };
  return { ...base, sources: overrides.sources ?? sourcesFor('specialists', base) };
}

/** An action of the catalog: its level, file and raw values; the id is the file name. */
export function actionEntry(
  id: string,
  raw: Record<string, unknown>,
  level: EntryLevel = 'project',
): ActionEntry {
  const base = {
    id,
    level,
    file: `${level === 'global' ? '/xdg/aip' : '/repo/aip'}/actions/${id}.yaml`,
    revision: `rev-${id}`,
    raw,
  };
  return { ...base, sources: sourcesFor('actions', base) };
}

/** The built-in stages of the pipeline as the daemon lists them. */
export function systemStagesView(
  overrides: Partial<SystemStagesResponse> = {},
): SystemStagesResponse {
  return {
    repository: '/repo',
    errors: [],
    stages: [
      {
        kind: 'split',
        name: 'Split',
        task: 'Split the task into at most {max_groups} groups.',
        settings: [],
      },
      {
        kind: 'message',
        name: 'Commit message',
        task: 'Write the commit message of {run}.',
        settings: [{ path: 'delivery.message_prompt', value: '', level: 'default' }],
      },
      {
        kind: 'delivery',
        name: 'Delivery',
        task: null,
        settings: [
          { path: 'delivery.mode', value: 'worktree', level: 'default' },
          { path: 'delivery.keep', value: false, level: 'default' },
        ],
      },
      {
        kind: 'resolve',
        name: 'Resolve conflicts',
        task: 'Resolve the conflicts of {run}.',
        settings: [
          { path: 'delivery.resolver', value: 'coder', level: 'global' },
          { path: 'delivery.resolver_prompt', value: '', level: 'default' },
        ],
      },
    ],
    ...overrides,
  };
}

/** The files of each level an entry has, derived from its level, file and raw values. */
export function sourcesFor(
  directory: 'specialists' | 'pipelines' | 'actions',
  entry: { level: EntryLevel; file: string; revision: string | null; raw: Record<string, unknown> },
  globalRaw: Record<string, unknown> = entry.raw,
): EntrySources {
  const name = entry.file.slice(entry.file.lastIndexOf('/') + 1);
  const global = {
    file: `/xdg/aip/${directory}/${name}`,
    revision: `global-${entry.revision ?? name}`,
  };
  if (entry.level === 'global') {
    return {
      global: { file: entry.file, revision: entry.revision ?? global.revision, raw: entry.raw },
    };
  }
  const project = { file: entry.file, revision: entry.revision ?? '', raw: entry.raw };
  return entry.level === 'project'
    ? { project }
    : { project, global: { ...global, raw: globalRaw } };
}

export function queueItem(
  id: string,
  task: string,
  position: number,
  extra: Partial<QueueItemView> = {},
) {
  return {
    id,
    number: position,
    position,
    pipeline: 'feature',
    pipelineName: extra.pipeline ?? 'feature',
    variant: 'default',
    variantName: extra.variant ?? 'default',
    provider: null,
    providerName: null,
    author: null,
    createdBySystem: false,
    task,
    groups: null,
    title: null,
    autoDeliver: null,
    deliveryMode: null,
    tags: [],
    skip: [],
    readiness: 'ready' as const,
    after: [],
    links: [],
    linkedBy: [],
    postponed: false,
    filtered: false,
    createdAt: 1,
    error: null,
    run: null,
    cleansRun: false,
    hold: null,
    attachments: [] as QueueItemView['attachments'],
    ...extra,
  };
}

/** A predecessor of a queued task, as the daemon reports it. */
export function dependency(
  kind: 'item' | 'run',
  id: string,
  title: string,
  state: 'done' | 'waiting' | 'blocked' = 'waiting',
  repository: string | null = null,
) {
  return { kind, id, number: null, title, state, repository };
}

type SettingSpec = [
  path: string,
  kind: EditorSetting['kind'],
  value: unknown,
  extra?: Pick<EditorSetting, 'options' | 'range'> & { globalOnly?: boolean },
];

const OPTIONS = {
  runtime: ['claude', 'opencode', 'agy'],
  permissions: ['read', 'edit', 'full'],
};

const SETTING_SPECS: SettingSpec[] = [
  ['max', 'integer', 3, { range: [1, 32] }],
  ['workspace_dir', 'string', '.aip'],
  ['outside_changes', 'choice', 'warn', { options: ['warn', 'stop', 'off'] }],
  ['defaults.runtime', 'choice', 'claude', { options: OPTIONS.runtime }],
  ['defaults.permissions', 'choice', 'edit', { options: OPTIONS.permissions }],
  ['defaults.timeout', 'duration', '30m'],
  ['defaults.allow_commands', 'strings', []],
  ['defaults.tools', 'strings', []],
  ['claude.edit_mode', 'choice', 'allowlist', { options: ['allowlist', 'accept_edits', 'auto'] }],
  ['claude.mcp', 'choice', 'isolated', { options: ['isolated', 'inherit'] }],
  ['claude.settings', 'choice', 'isolated', { options: ['isolated', 'inherit'] }],
  ['claude.overrides', 'json', {}],
  ['opencode.mcp', 'choice', 'inherit', { options: ['inherit', 'isolated'] }],
  ['opencode.overrides', 'json', {}],
  ['agy.mcp', 'choice', 'isolated', { options: ['isolated', 'inherit'] }],
  ['agy.overrides', 'json', {}],
  ['delivery.mode', 'choice', 'worktree', { options: ['worktree', 'commit', 'branch'] }],
  ['delivery.auto', 'boolean', true],
  ['delivery.keep', 'boolean', false],
  ['delivery.commit_message', 'string', '{title}\n\n{groups}'],
  ['delivery.message_specialist', 'specialist', null],
  ['delivery.resolver', 'specialist', null],
  ['delivery.resolver_rounds', 'integer', 3, { range: [1, 10] }],
  ['delivery.message_prompt', 'string', null],
  ['delivery.resolver_prompt', 'string', null],
  ['workspace.base', 'choice', 'working_tree', { options: ['working_tree', 'head'] }],
  ['workspace.include', 'strings', []],
  ['naming.enabled', 'boolean', true],
  ['naming.runtime', 'choice', 'claude', { options: OPTIONS.runtime }],
  ['naming.model', 'string', 'haiku'],
  ['web.autostart', 'boolean', true, { globalOnly: true }],
  ['web.auth', 'choice', 'token', { options: ['token', 'none'], globalOnly: true }],
  [
    'web.host',
    'choice',
    '127.0.0.1',
    { options: ['127.0.0.1', 'localhost', '::1'], globalOnly: true },
  ],
  ['web.port', 'integer', 7341, { range: [1, 65535], globalOnly: true }],
  ['network.enabled', 'boolean', false, { globalOnly: true }],
  ['network.targets', 'strings', ['https://api.anthropic.com'], { globalOnly: true }],
  ['network.interfaces', 'strings', [], { globalOnly: true }],
  ['network.proxy', 'string', null, { globalOnly: true }],
  ['network.interval', 'integer', 30, { range: [5, 3600], globalOnly: true }],
  ['network.timeout', 'integer', 5, { range: [1, 60], globalOnly: true }],
  ['attachments.storage', 'choice', 'local', { options: ['local', 's3'], globalOnly: true }],
  ['attachments.s3.bucket', 'string', null, { globalOnly: true }],
  ['attachments.s3.region', 'string', 'us-east-1', { globalOnly: true }],
  ['attachments.s3.endpoint', 'string', null, { globalOnly: true }],
  ['attachments.s3.prefix', 'string', 'aip/attachments/', { globalOnly: true }],
  ['attachments.s3.path_style', 'boolean', false, { globalOnly: true }],
  ['queue.scope', 'choice', 'project', { options: ['project', 'global'], globalOnly: true }],
  ['queue.max', 'integer', 5, { range: [1, 32], globalOnly: true }],
  ['queue.pools', 'pools', {}, { globalOnly: true }],
  ['queue.default_pool.max', 'integer', null, { range: [1, 32], globalOnly: true }],
  ['stats.enabled', 'boolean', true, { globalOnly: true }],
  ['stats.exclude', 'strings', [], { globalOnly: true }],
  ['runtimes.claude.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.claude.command', 'string', 'claude', { globalOnly: true }],
  ['runtimes.claude.args', 'strings', [], { globalOnly: true }],
  ['runtimes.claude.env', 'env', ['ANTHROPIC_API_KEY'], { globalOnly: true }],
  ['runtimes.opencode.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.opencode.command', 'string', 'opencode', { globalOnly: true }],
  ['runtimes.opencode.args', 'strings', [], { globalOnly: true }],
  ['runtimes.opencode.env', 'env', [], { globalOnly: true }],
  ['runtimes.agy.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.agy.command', 'string', 'agy', { globalOnly: true }],
  ['runtimes.agy.args', 'strings', [], { globalOnly: true }],
  ['runtimes.agy.env', 'env', [], { globalOnly: true }],
  ['runtimes.codex.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.codex.command', 'string', 'codex', { globalOnly: true }],
  ['runtimes.codex.args', 'strings', [], { globalOnly: true }],
  ['runtimes.codex.env', 'env', [], { globalOnly: true }],
  ['runtimes.kilo.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.kilo.command', 'string', 'kilo', { globalOnly: true }],
  ['runtimes.kilo.args', 'strings', [], { globalOnly: true }],
  ['runtimes.kilo.env', 'env', [], { globalOnly: true }],
  ['runtimes.cline.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.cline.command', 'string', 'cline', { globalOnly: true }],
  ['runtimes.cline.args', 'strings', [], { globalOnly: true }],
  ['runtimes.cline.env', 'env', [], { globalOnly: true }],
  ['runtimes.copilot.enabled', 'boolean', false, { globalOnly: true }],
  ['runtimes.copilot.command', 'string', 'copilot', { globalOnly: true }],
  ['runtimes.copilot.args', 'strings', [], { globalOnly: true }],
  ['runtimes.copilot.env', 'env', [], { globalOnly: true }],
];

/**
 * The settings of the editor view with their defaults. An override is the part of a setting that
 * changes: a test names `value`, `file`, `written` and so on, and the rest stays as it was.
 */
export function settingsOf(
  overrides: Record<string, Partial<EditorSetting> & { path: string }> = {},
): EditorSetting[] {
  return SETTING_SPECS.map(([path, kind, value, extra]) => {
    const base: EditorSetting = {
      path,
      kind,
      value,
      file: null,
      ...(extra?.options ? { options: extra.options } : {}),
      ...(extra?.range ? { range: extra.range } : {}),
      globalOnly: extra?.globalOnly ?? false,
      defaultValue: value,
      globalValue: value,
      written: {},
    };
    const override = overrides[path];
    if (!override) return base;
    const merged = { ...base, ...override };
    // a value that changes also changes what the shared level says, unless the test says otherwise
    if (override.value !== undefined && override.globalValue === undefined) {
      merged.globalValue = override.value;
    }
    return merged;
  });
}

export function systemView(overrides: Partial<SystemView> = {}): SystemView {
  return {
    daemon: {
      running: true,
      pid: 100,
      version: '1.2.3',
      build: 'abc123',
      busy: false,
      mismatch: null,
    },
    web: {
      running: true,
      pid: 100,
      url: 'http://127.0.0.1:7341/',
      host: '127.0.0.1',
      port: 7341,
      auth: 'token',
      version: '1.2.3',
      build: 'abc123',
      servedBy: 'daemon',
    },
    network: { state: 'off', problem: null, checkedAt: null, since: 1000, proxy: null },
    attachments: { s3Credentials: false },
    logPath: '/state/daemon.log',
    ...overrides,
  };
}

/** The models per runtime: Claude's built-in list, OpenCode by providers and an empty agy. */
export function modelsView(overrides: Partial<ConfigModelsResponse> = {}): ConfigModelsResponse {
  return {
    repository: '/repo',
    runtimes: {
      claude: {
        models: [
          { id: 'opus', name: 'opus', group: 'aliases' },
          { id: 'sonnet', name: 'sonnet', group: 'aliases' },
          { id: 'claude-opus-5-5', name: 'claude-opus-5-5', group: 'anthropic' },
        ],
        error: null,
      },
      opencode: {
        models: [
          { id: 'openai/gpt-5', name: 'gpt-5', group: 'openai' },
          {
            id: 'openrouter/anthropic/claude-opus-5-5',
            name: 'anthropic/claude-opus-5-5',
            group: 'openrouter',
          },
        ],
        error: null,
      },
      agy: { models: [], error: null },
      codex: { models: [], error: null },
      kilo: { models: [], error: null },
      cline: { models: [], error: null },
      copilot: { models: [], error: null },
    },
    ...overrides,
  };
}

export function catalogView(overrides: Partial<ConfigCatalogResponse> = {}): ConfigCatalogResponse {
  return {
    repository: '/repo',
    mcpInherited: false,
    runtimes: {
      claude: {
        tools: [
          { name: 'WebFetch', source: 'builtin' },
          { name: 'WebSearch', source: 'builtin' },
          { name: 'mcp__jira', source: 'project' },
        ],
        skills: [
          { name: 'review', source: 'project', description: 'Code review' },
          { name: 'review', source: 'global' },
          { name: 'grill-me-2', source: 'global' },
        ],
      },
      opencode: { tools: [], skills: [] },
      agy: { tools: [], skills: [] },
      codex: { tools: [], skills: [] },
      kilo: { tools: [], skills: [] },
      cline: { tools: [], skills: [] },
      copilot: { tools: [], skills: [] },
    },
    ...overrides,
  };
}

/** A folder of the specialist tags: `repository` null is the shared level. */
export function tagFolder(
  repository: string | null,
  specialists: { slug: string; tags?: string[]; name?: string | null; error?: string }[],
): SpecialistTagFolderView {
  const base = repository ?? '/xdg/aip';
  return {
    repository,
    directory: `${base}${repository === null ? '' : '/aip'}/specialists`,
    specialists: specialists.map((entry) => ({
      slug: entry.slug,
      name: entry.name === undefined ? entry.slug.toUpperCase() : entry.name,
      tags: entry.tags ?? [],
      revision: entry.error ? null : `rev-${entry.slug}`,
      ...(entry.error ? { error: entry.error } : {}),
    })),
  };
}

export function configView(overrides: Partial<ConfigEditorResponse> = {}): ConfigEditorResponse {
  return {
    repository: '/repo',
    directories: { global: '/xdg/aip', project: '/repo/aip' },
    settingsFiles: {
      global: { file: '/xdg/aip/settings.yaml', revision: 'g1' },
      project: { file: '/repo/aip/settings.yaml', revision: null },
    },
    specialists: [specialistEntry('coder', { raw: { name: 'Code author', model: 'sonnet' } })],
    chains: [],
    providers: [],
    pipelines: [],
    actions: [],
    settings: settingsOf(),
    mcpServers: [],
    errors: [],
    ...overrides,
  };
}

const NO_PER_TASK = {
  tokens: { mean: 0, median: 0 },
  agentMs: { mean: 0, median: 0 },
  wallMs: { mean: 0, median: 0 },
};

/** An empty report of the statistics: nothing in the period, collection on. */
export function deliveryView(overrides: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: 1,
    subscription: 'n1',
    event: 'r1/g/needs_human/1',
    kind: 'question',
    run: 'run1',
    group: 'login',
    state: 'sent',
    attempts: 1,
    lastAttemptAt: 1_700_000_000_000,
    error: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** A webhook of all projects that waits for its secret. */
export function webhookView(overrides: Partial<WebhookView> = {}): WebhookView {
  return {
    id: 'w1',
    name: 'ci',
    url: 'https://ci.example.com/hook',
    project: null,
    events: ['question'],
    enabled: false,
    secret: false,
    disabledReason: null,
    failureStreak: 0,
    ...overrides,
  };
}

/** A delivery of a webhook with three attempts. */
export function webhookDeliveryView(
  overrides: Partial<WebhookDeliveryView> = {},
): WebhookDeliveryView {
  return {
    id: 5,
    webhookId: 'msg_abc123',
    type: 'question.asked',
    run: 'run1',
    group: 'login',
    state: 'sent',
    attempts: [
      {
        n: 1,
        at: 1_700_000_000_000,
        statusCode: 503,
        error: 'server_error',
        durationMs: 20,
        excerpt: 'down',
      },
      {
        n: 2,
        at: 1_700_000_005_000,
        statusCode: null,
        error: 'timeout',
        durationMs: 10000,
        excerpt: null,
      },
      { n: 3, at: 1_700_000_065_000, statusCode: 200, error: null, durationMs: 31, excerpt: 'ok' },
    ],
    error: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** A shared Telegram connection without the token, with one subscription of all projects. */
/** A link of a project to a project of a service registry. */
export function projectLinkView(
  connection: string,
  project: string,
  overrides: Partial<ProjectLinkView> = {},
): ProjectLinkView {
  return {
    project,
    connection,
    connectionName: 'main',
    registryPath: 'acme/backend/api',
    source: 'auto',
    status: 'linked',
    candidates: [],
    matchedAt: 1,
    url: 'https://registry.example.com/catalog?node=acme%2Fbackend%2Fapi',
    ...overrides,
  };
}

export function integrationsOverview(
  overrides: Partial<IntegrationsOverview> = {},
): IntegrationsOverview {
  return {
    connections: [
      {
        id: 'c1',
        kind: 'telegram',
        name: 'main',
        scope: 'global',
        project: null,
        params: { allowed_users: '111' },
        enabled: false,
        state: 'ready',
        secrets: [{ slot: 'bot_token', required: true, present: false }],
        pending: false,
        lastCheck: null,
        channel: null,
      },
    ],
    types: [
      {
        kind: 'telegram',
        title: 'Telegram bot',
        params: [
          { name: 'chat_id', required: false, maxLength: 20 },
          {
            name: 'allowed_users',
            required: false,
            maxLength: 400,
            pattern: '[1-9][0-9]{0,17}(,[1-9][0-9]{0,17})*',
            userList: true,
          },
          { name: 'language', required: false, maxLength: 2, values: ['en', 'ru'] },
        ],
        secrets: [{ slot: 'bot_token', required: true }],
        directions: ['inbound', 'outbound'],
        operations: [],
      },
    ],
    subscriptions: [
      {
        id: 'n1',
        connection: 'c1',
        connectionName: 'main',
        kind: 'telegram',
        project: null,
        events: ['question'],
        enabled: true,
      },
    ],
    channels: [],
    ...overrides,
  };
}

export function statsReportView(overrides: Partial<StatsReportView> = {}): StatsReportView {
  return {
    settings: { enabled: true, exclude: [], backfilledAt: null },
    since: null,
    until: null,
    repository: null,
    totals: {
      tasks: 0,
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      agentMs: 0,
      commandMs: 0,
      wallMs: 0,
    },
    perTask: NO_PER_TASK,
    outcomes: { finished: 0, failed: 0, cancelled: 0 },
    projects: [],
    bySpecialist: [],
    byModel: [],
    byPipeline: [],
    byRuntime: [],
    series: [],
    ...overrides,
  };
}

/**
 * An Api whose calls are `vi.fn` mocks. `forRepository(path)` returns a sibling that calls the
 * same mocks and records `[method, repository]` in `calls`, so a test can tell which
 * repository a request was bound to.
 */
export function fakeApi(overrides: Partial<Api> = {}): Api & { calls: [string, string | null][] } {
  const calls: [string, string | null][] = [];
  const transcript: Transcript = {
    runId: 'run1',
    group: 'login',
    seq: 1,
    cursor: 0,
    running: false,
    entries: [],
  };
  const base: Omit<Api, 'forRepository'> = {
    runs: vi.fn(async () => [runView()]),
    finishedRuns: vi.fn(async () => ({ runs: [], next: null })),
    run: vi.fn(async () => {
      throw new ApiError(404, 'unknown run');
    }),
    repositories: vi.fn(async () => []),
    addRepository: vi.fn(async () => []),
    updateRepository: vi.fn(async () => []),
    usersDirectory: vi.fn(async () => []),
    accessMe: vi.fn(async (repository: string | null) => ({
      actor: 'local' as const,
      userId: null,
      repository,
      actions: [],
      conditional: [],
      repositories: null,
    })),
    moveRepository: vi.fn(async () => []),
    removeRepository: vi.fn(async () => []),
    directories: vi.fn(async () => ({
      path: '/home/me',
      parent: '/home',
      home: '/home/me',
      git: false,
      entries: [],
      truncated: false,
    })),
    pipelines: vi.fn(async () => pipelinesView()),
    group: vi.fn(async () => groupView()),
    groupSpec: vi.fn(async () => null),
    groupArtifacts: vi.fn(async () => []),
    artifactUrl: vi.fn(
      (run: string, group: string, id: string, inline?: boolean) =>
        `/api/runs/${run}/groups/${group}/artifacts/${id}${inline ? '?inline=1' : ''}`,
    ),
    artifactText: vi.fn(async () => ''),
    uploadAttachment: vi.fn(async (file: File) => ({
      upload: `up-${file.name}`,
      fileName: file.name,
      size: file.size,
    })),
    attachmentUrl: vi.fn(
      (run: string, id: string, inline?: boolean) =>
        `/api/runs/${run}/attachments/${id}${inline ? '?inline=1' : ''}`,
    ),
    transcript: vi.fn(async () => transcript),
    fileDiff: vi.fn(async (_run: string, _group: string, path: string) => ({
      path,
      previousPath: null,
      binary: false,
      lines: ['@@ -1,2 +1,2 @@', ' same', '-old', '+new'],
      totalLines: 4,
      truncated: false,
    })),
    runPatch: vi.fn(async () => ({ blob: new Blob(['patch']), fileName: 'run1.patch' })),
    answer: vi.fn(async () => ({})),
    message: vi.fn(async () => ({})),
    retry: vi.fn(async () => ({})),
    skipStep: vi.fn(async () => ({})),
    setRunVariant: vi.fn(async () => runView()),
    setRunProvider: vi.fn(async () => runView()),
    cancel: vi.fn(async () => ({})),
    cleanRun: vi.fn(async () => ({ run: runView(), removed: [] })),
    apply: vi.fn(async () => ({ runId: 'run1', number: 1, pending: false, groups: [] })),
    markDelivered: vi.fn(async () => ({ runId: 'run1', number: 1, pending: false, groups: [] })),
    processes: vi.fn(async () => ({ processes: [] })),
    killProcess: vi.fn(async () => ({ ok: true })),
    tags: vi.fn(async () => []),
    addTag: vi.fn(async (name: string) => [tagView(name)]),
    editTag: vi.fn(async () => []),
    removeTag: vi.fn(async () => []),
    removeTags: vi.fn(async () => []),
    setRunTitle: vi.fn(async () => runView()),
    cancelAutoDelivery: vi.fn(async () => runView({ autoDeliver: false })),
    setRunTags: vi.fn(async () => runView()),
    queue: vi.fn(async () => queueOf()),
    queueAdd: vi.fn(async () => ({ ...queueOf(), item: 'q1' })),
    queueAddProjects: vi.fn(async () => []),
    queueEdit: vi.fn(async () => queueOf()),
    taskLink: vi.fn(async () => ({})),
    taskUnlink: vi.fn(async () => ({})),
    queueRemove: vi.fn(async () => queueOf()),
    queueRunNow: vi.fn(async () => ({
      runId: 'run9',
      number: 9,
      branch: 'refs/aip/run9/run',
      groups: [],
      split: true,
      warnings: [],
    })),
    queueStart: vi.fn(async () => queueOf({ status: 'running' })),
    queuePause: vi.fn(async () => queueOf()),
    queueSettings: vi.fn(async () => queueOf()),
    queueReturn: vi.fn(async () => ({ ...queueOf(), item: 'q9' })),
    pauseRun: vi.fn(async () => ({ ...queueOf(), item: 'q9' })),
    queueDismiss: vi.fn(async () => queueOf()),
    system: vi.fn(async () => systemView()),
    restartWeb: vi.fn(async () => undefined),
    restartDaemon: vi.fn(async () => undefined),
    stopDaemon: vi.fn(async () => undefined),
    startDaemon: vi.fn(async () => undefined),
    config: vi.fn(async () => configView()),
    catalog: vi.fn(async () => catalogView()),
    models: vi.fn(async () => modelsView()),
    writeSpecialist: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteSpecialist: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    sharedSpecialists: vi.fn(async () => ({ directory: '/xdg/aip/specialists', specialists: [] })),
    specialistTags: vi.fn(async () => ({ folders: [] })),
    importSpecialists: vi.fn(async (_source: string, slugs: string[]) => ({
      ok: true as const,
      imported: slugs,
    })),
    sharedPipelines: vi.fn(async () => ({ directory: '/xdg/aip/pipelines', pipelines: [] })),
    importPipelines: vi.fn(async (_source: string, ids: string[]) => ({
      ok: true as const,
      imported: ids,
    })),
    writePipeline: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    writeSettings: vi.fn(async () => ({
      ok: true as const,
      revision: 'g2',
      file: '/xdg/aip/settings.yaml',
    })),
    writeSetting: vi.fn(async () => ({
      ok: true as const,
      revision: 'g2',
      file: '/xdg/aip/settings.yaml',
    })),
    deletePipeline: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    previewPipeline: vi.fn(async () => ({ topology: pipelineOf(), errors: [] })),
    writeAction: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteAction: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    writeMcpServer: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteMcpServer: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    writeChain: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteChain: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    providers: vi.fn(async () => ({
      repository: '/repo',
      errors: [],
      roles: [],
      providers: [],
      defaultProvider: null,
      matrix: [],
    })),
    providerModels: vi.fn(async (provider: string) => ({
      repository: '/repo',
      provider,
      access: [],
    })),
    writeProvider: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteProvider: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    systemStages: vi.fn(async () => ({ repository: '/repo', stages: [], errors: [] })),
    observers: vi.fn(async () => observersView()),
    observerHistory: vi.fn(async () => ({
      items: [],
      nextCursor: null,
      limit: 20,
      projects: [],
      asOf: Date.now(),
    })),
    setObservers: vi.fn(async (settings: ObserverSettings) => ({
      ok: true as const,
      view: observersView({ settings }),
    })),
    setRunObserver: vi.fn(async () => ({})),
    statsReport: vi.fn(async () => statsReportView()),
    statsClear: vi.fn(async () => ({ removed: 0 })),
    integrations: vi.fn(async () => integrationsOverview()),
    integrationAdd: vi.fn(async () => integrationsOverview().connections[0]!),
    integrationEnabled: vi.fn(async () => integrationsOverview().connections[0]!),
    integrationRemove: vi.fn(async () => undefined),
    integrationCheck: vi.fn(async () => integrationsOverview().connections[0]!),
    integrationEdit: vi.fn(async () => integrationsOverview().connections[0]!),
    integrationLinks: vi.fn(async () => []),
    integrationSenders: vi.fn(async () => []),
    integrationLink: vi.fn(async (id: string, repository: string) =>
      projectLinkView(id, repository),
    ),
    subscriptionAdd: vi.fn(async () => integrationsOverview().subscriptions[0]!),
    subscriptionEvents: vi.fn(async () => integrationsOverview().subscriptions[0]!),
    subscriptionEnabled: vi.fn(async () => integrationsOverview().subscriptions[0]!),
    subscriptionRemove: vi.fn(async () => undefined),
    subscriptionTest: vi.fn(async () => deliveryView()),
    deliveries: vi.fn(async () => []),
    webhooks: vi.fn(async () => []),
    webhookAdd: vi.fn(async () => webhookView()),
    webhookEdit: vi.fn(async () => webhookView()),
    webhookEnabled: vi.fn(async () => webhookView()),
    webhookRemove: vi.fn(async () => undefined),
    webhookTest: vi.fn(async () => ({ ok: true, statusCode: 200, durationMs: 12, error: null })),
    webhookLog: vi.fn(async () => []),
    webhookRedeliver: vi.fn(async () => webhookDeliveryView()),
    registrySkills: vi.fn(async () => []),
    ...overrides,
  };
  /** Methods that record the repository they were bound to, then call the shared mock. */
  const bind = (repository: string | null): Api => {
    const scoped: Record<string, unknown> = { forRepository: bind, repository };
    for (const [name, fn] of Object.entries(base)) {
      scoped[name] = (...args: unknown[]) => {
        calls.push([name, repository]);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    }
    return scoped as unknown as Api;
  };
  const api = { ...base, forRepository: bind, calls };
  FakeSocket.api = api;
  return api;
}

type SentMessage = {
  op: string;
  id: string;
  topic?: { kind: string } & Record<string, unknown>;
};

/**
 * The live connection of a test. It stands in for the server: a subscription is answered from the
 * last `fakeApi` (as the server reads the daemon), and after a `run` event the topics of the runs
 * are read again and sent when they changed. `FakeSocket.answers = false` leaves every answer to
 * the test (`topic`).
 */
export class FakeSocket implements SocketLike {
  static last: FakeSocket | null = null;
  /** The API the subscriptions are answered from: the last one `fakeApi` made. */
  static api: Api | null = null;
  static answers = true;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  /** The messages the panel sent, parsed. */
  sent: SentMessage[] = [];
  private readonly answered = new Map<string, string>();

  constructor() {
    FakeSocket.last = this;
  }

  /** The connection comes up. */
  open(): void {
    this.onopen?.(new Event('open'));
  }

  /** A message of the panel (a string), or a message of the server to give to the panel. */
  send(data: unknown): void {
    if (typeof data === 'string') {
      const message = JSON.parse(data) as SentMessage;
      this.sent.push(message);
      if (message.op === 'refresh') this.answered.delete(message.id);
      if (message.op !== 'unsubscribe') void this.answer(message.id);
      return;
    }
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    if ((data as { event?: string }).event !== 'run') return;
    // the server reads the topics of the runs again after a change of a run
    for (const held of this.subscriptions()) {
      if (held.topic?.kind !== 'transcript') void this.answer(held.id);
    }
  }

  /** The connection breaks. */
  fail(): void {
    this.closed = true;
    this.onclose?.();
  }

  close(): void {
    this.closed = true;
  }

  /** The subscriptions the panel holds now, of one kind or of all. */
  subscriptions(kind?: string): SentMessage[] {
    const dropped = new Set(
      this.sent.filter((message) => message.op === 'unsubscribe').map((message) => message.id),
    );
    return this.sent.filter(
      (message) =>
        message.op === 'subscribe' &&
        !dropped.has(message.id) &&
        (kind === undefined || message.topic?.kind === kind),
    );
  }

  /** Sends the data of a topic to the last subscription of this kind that matches. */
  topic(kind: string, data: unknown, where: Record<string, unknown> = {}): void {
    const found = this.subscriptions(kind)
      .filter((message) =>
        Object.entries(where).every(([key, value]) => message.topic?.[key] === value),
      )
      .at(-1);
    if (!found) throw new Error(`the panel holds no subscription to ${kind}`);
    this.send({ event: 'topic', id: found.id, data });
  }

  /** Tells the last subscription of this kind that the read of its topic failed. */
  topicError(kind: string, error: string): void {
    const found = this.subscriptions(kind).at(-1);
    if (!found) throw new Error(`the panel holds no subscription to ${kind}`);
    this.send({ event: 'topic_error', id: found.id, error });
  }

  /** Reads the topic of a subscription from the fake API and sends it when it is new. */
  private async answer(id: string): Promise<void> {
    const api = FakeSocket.api;
    const topic = this.subscriptions().find((message) => message.id === id)?.topic;
    if (!FakeSocket.answers || api === null || topic === undefined) return;
    const { runId, group, seq, after, repository, level } = topic as unknown as {
      runId: string;
      group: string;
      seq: number;
      after?: number;
      repository?: string;
      level?: 'global';
    };
    let message: Record<string, unknown>;
    try {
      const data =
        topic.kind === 'transcript'
          ? await api.transcript(runId, group, seq, after ?? 0)
          : topic.kind === 'group'
            ? await api.group(runId, group)
            : topic.kind === 'group_spec'
              ? await api.groupSpec(runId, group)
              : await (repository === undefined ? api : api.forRepository(repository)).providers(
                  level,
                );
      message = { event: 'topic', id, data };
    } catch (error) {
      message = { event: 'topic_error', id, error: (error as Error).message };
    }
    const text = JSON.stringify(message);
    const held = this.subscriptions().some((candidate) => candidate.id === id);
    if (this.closed || !held || this.answered.get(id) === text) return;
    this.answered.set(id, text);
    this.onmessage?.(new MessageEvent('message', { data: text }));
  }
}

export const openFake = () => new FakeSocket();

/**
 * A live connection for a component rendered without the panel around it: the topics are
 * subscribed on the returned socket. The test ends it with `liveTopics.detach()`.
 */
export function attachLive(): FakeSocket {
  const socket = new FakeSocket();
  socket.onmessage = (message) =>
    void liveTopics.message(JSON.parse(message.data) as { event: string });
  liveTopics.opened((message) => {
    socket.send(JSON.stringify(message));
    return true;
  });
  return socket;
}

/** A registry entry of the daemon's list of repositories. */
export function repositoryView(
  path = '/repo',
  overrides: Partial<RepositoryView> = {},
): RepositoryView {
  const directory = path.replace(/\/+$/, '').split('/').pop() || path;
  return {
    path,
    displayPath: path,
    addedAt: 1,
    name: null,
    label: directory,
    slug: directory.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    enabled: true,
    color: null,
    unfinished: 0,
    waiting: 0,
    queued: 0,
    ...overrides,
  };
}

type Use = RunView['specialists'][number];

/** A specialist of a run with the groups running on it and waiting for it. */
export function specialistUse(
  specialist: string,
  overrides: {
    level?: Use['level'];
    name?: string;
    max?: number | null;
    running?: string[];
    waiting?: string[];
  } = {},
): Use {
  const item = (slug: string) => ({ slug, title: slug, step: 'code', stepName: 'Coder' });
  return {
    specialist,
    name: overrides.name ?? specialist,
    level: overrides.level ?? 'project',
    max: overrides.max ?? null,
    running: (overrides.running ?? []).map((slug) => ({ ...item(slug), startedAt: 1_000 })),
    waiting: (overrides.waiting ?? []).map(item),
  };
}
