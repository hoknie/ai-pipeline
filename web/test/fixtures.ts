import { vi } from 'vitest';

import { ApiError, type Api } from '../src/api.ts';
import type { EventSourceLike } from '../src/store.ts';
import type {
  BackgroundProcessView,
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSetting,
  EditorSpecialist,
  EntryLevel,
  EntrySources,
  GroupRow,
  GroupView,
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
  WorkflowTopology,
  WorkflowsView,
  SystemView,
  SpecialistTagFolderView,
} from '../src/types.ts';

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
        groups: [{ slug: 'login', title: 'Вход', status: 'running' }],
        attempts: 2,
        usage: { inputTokens: 10, outputTokens: 1, costUsd: 0.3 },
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
    ...overrides,
  };
}

export function groupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    slug: 'login',
    title: 'Вход',
    status: 'running',
    hold: null,
    step: 'code',
    stepName: 'Кодер',
    round: 1,
    durationMs: 65_000,
    question: null,
    questions: null,
    humanOnly: null,
    reason: null,
    warnings: 0,
    delivery: 'pending',
    diff: null,
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
      runTitle: 'Первый',
      repository: '/work/app',
      group: 'login',
      groupTitle: 'Логин',
      step: 'code',
    },
    ...overrides,
  };
}

export function runView(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'run1',
    title: 'добавить вход',
    name: null,
    repository: '/repo',
    workflow: 'feature',
    workflowName: overrides.workflow ?? 'feature',
    branch: 'refs/aip/run1/run',
    createdAt: 1_000,
    startedAt: 1_000,
    finishedAt: null,
    finished: false,
    state: 'active',
    waiting: 0,
    dirtyWarning: false,
    autoDeliver: true,
    deliveryMode: 'worktree',
    fromQueue: false,
    returnable: false,
    queueItem: null,
    hold: null,
    clockStoppedAt: null,
    number: 1,
    tags: [],
    counts: 'running 1',
    total: 1,
    progress: { done: 0, total: 1 },
    usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.42 },
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
    decisions: [],
    ...overrides,
  };
}

export function groupView(overrides: Partial<GroupView> = {}): GroupView {
  return {
    runId: 'run1',
    slug: 'login',
    title: 'Вход',
    task: 'сделать **вход**',
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
        stepName: 'Кодер',
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

export function workflowOf(overrides: Partial<WorkflowTopology> = {}): WorkflowTopology {
  return {
    id: 'feature',
    name: overrides.id ?? 'feature',
    split: null,
    steps: topologyOf().steps.map(
      ({ groups: _g, attempts: _a, rejections: _r, usage: _u, skipped: _s, ...step }) => step,
    ),
    delivery: { mode: 'worktree', resolver: null },
    limits: {},
    ...overrides,
  };
}

export function workflowsView(overrides: Partial<WorkflowsView> = {}): WorkflowsView {
  return { repository: '/repo', workflows: [workflowOf()], errors: [], ...overrides };
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
    workflow: 'feature',
    workflowName: overrides.workflow ?? 'feature',
    tags: [],
    createdAt: 0,
    groups: { done: 0, total: 1 },
    steps: { done: 0, total: 4, current: { step: 'plan', name: 'Планировщик', number: 1 } },
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

/** The files of each level an entry has, derived from its level, file and raw values. */
export function sourcesFor(
  directory: 'specialists' | 'workflows',
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
    workflow: 'feature',
    workflowName: extra.workflow ?? 'feature',
    task,
    groups: null,
    title: null,
    autoDeliver: null,
    deliveryMode: null,
    tags: [],
    skip: [],
    readiness: 'ready' as const,
    after: [],
    postponed: false,
    createdAt: 1,
    error: null,
    run: null,
    hold: null,
    ...extra,
  };
}

/** A predecessor of a queued task, as the daemon reports it. */
export function dependency(
  kind: 'item' | 'run',
  id: string,
  title: string,
  state: 'done' | 'waiting' | 'blocked' = 'waiting',
) {
  return { kind, id, number: null, title, state };
}

type SettingSpec = [
  path: string,
  kind: EditorSetting['kind'],
  value: unknown,
  extra?: Pick<EditorSetting, 'options' | 'range'> & { globalOnly?: boolean },
];

const OPTIONS = {
  runtime: ['claude', 'opencode'],
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
  ['delivery.mode', 'choice', 'worktree', { options: ['worktree', 'commit', 'branch'] }],
  ['delivery.auto', 'boolean', true],
  ['delivery.keep', 'boolean', false],
  ['delivery.commit_message', 'string', '{title}\n\n{groups}'],
  ['delivery.message_specialist', 'specialist', null],
  ['delivery.resolver', 'specialist', null],
  ['delivery.resolver_rounds', 'integer', 3, { range: [1, 10] }],
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
  ['runtimes.claude.command', 'string', 'claude', { globalOnly: true }],
  ['runtimes.claude.args', 'strings', [], { globalOnly: true }],
  ['runtimes.claude.env', 'env', ['ANTHROPIC_API_KEY'], { globalOnly: true }],
  ['runtimes.opencode.command', 'string', 'opencode', { globalOnly: true }],
  ['runtimes.opencode.args', 'strings', [], { globalOnly: true }],
  ['runtimes.opencode.env', 'env', [], { globalOnly: true }],
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
    logPath: '/state/daemon.log',
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
          { name: 'review', source: 'project', description: 'Проверка кода' },
          { name: 'review', source: 'global' },
          { name: 'grill-me-2', source: 'global' },
        ],
      },
      opencode: { tools: [], skills: [] },
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
    specialists: [specialistEntry('coder', { raw: { name: 'Кодировщик', model: 'sonnet' } })],
    workflows: [],
    settings: settingsOf(),
    errors: [],
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
    removeRepository: vi.fn(async () => []),
    workflows: vi.fn(async () => workflowsView()),
    group: vi.fn(async () => groupView()),
    groupSpec: vi.fn(async () => null),
    groupArtifacts: vi.fn(async () => []),
    artifactUrl: vi.fn(
      (run: string, group: string, id: string, inline?: boolean) =>
        `/api/runs/${run}/groups/${group}/artifacts/${id}${inline ? '?inline=1' : ''}`,
    ),
    artifactText: vi.fn(async () => ''),
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
    cancel: vi.fn(async () => ({})),
    apply: vi.fn(async () => ({ runId: 'run1', number: 1, pending: false, groups: [] })),
    markDelivered: vi.fn(async () => ({ runId: 'run1', number: 1, pending: false, groups: [] })),
    processes: vi.fn(async () => ({ processes: [] })),
    killProcess: vi.fn(async () => ({ ok: true })),
    tags: vi.fn(async () => []),
    addTag: vi.fn(async (name: string) => [tagView(name)]),
    editTag: vi.fn(async () => []),
    removeTag: vi.fn(async () => []),
    setRunTitle: vi.fn(async () => runView()),
    setRunTags: vi.fn(async () => runView()),
    queue: vi.fn(async () => queueOf()),
    queueAdd: vi.fn(async () => ({ ...queueOf(), item: 'q1' })),
    queueEdit: vi.fn(async () => queueOf()),
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
    writeSpecialist: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteSpecialist: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    sharedSpecialists: vi.fn(async () => ({ directory: '/xdg/aip/specialists', specialists: [] })),
    specialistTags: vi.fn(async () => ({ folders: [] })),
    importSpecialists: vi.fn(async (_source: string, slugs: string[]) => ({
      ok: true as const,
      imported: slugs,
    })),
    writeWorkflow: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
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
    deleteWorkflow: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    previewWorkflow: vi.fn(async () => ({ topology: workflowOf(), errors: [] })),
    ...overrides,
  };
  /** Methods that record the repository they were bound to, then call the shared mock. */
  const bind = (repository: string | null): Api => {
    const scoped: Record<string, unknown> = { forRepository: bind };
    for (const [name, fn] of Object.entries(base)) {
      scoped[name] = (...args: unknown[]) => {
        calls.push([name, repository]);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    }
    return scoped as unknown as Api;
  };
  return { ...base, forRepository: bind, calls };
}

export class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor() {
    FakeEventSource.last = this;
  }

  open(): void {
    this.onopen?.(new Event('open'));
  }

  send(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.closed = true;
  }
}

export const openFake = () => new FakeEventSource();

/** A registry entry of the daemon's list of repositories. */
export function repositoryView(
  path = '/repo',
  overrides: Partial<RepositoryView> = {},
): RepositoryView {
  return { path, addedAt: 1, unfinished: 0, waiting: 0, queued: 0, ...overrides };
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
  const item = (slug: string) => ({ slug, title: slug, step: 'code', stepName: 'Кодер' });
  return {
    specialist,
    name: overrides.name ?? specialist,
    level: overrides.level ?? 'project',
    max: overrides.max ?? null,
    running: (overrides.running ?? []).map((slug) => ({ ...item(slug), startedAt: 1_000 })),
    waiting: (overrides.waiting ?? []).map(item),
  };
}
