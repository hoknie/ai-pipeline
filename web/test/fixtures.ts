import { vi } from 'vitest';

import type { Api } from '../src/api.ts';
import type { EventSourceLike } from '../src/store.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSetting,
  EditorSpecialist,
  EntryLevel,
  EntrySources,
  GroupRow,
  GroupView,
  QueueRunView,
  QueueView,
  RepositoryView,
  RunView,
  TagColor,
  TagView,
  Topology,
  Transcript,
  WorkflowTopology,
  WorkflowsView,
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
    step: 'code',
    round: 1,
    durationMs: 65_000,
    question: null,
    questions: null,
    reason: null,
    warnings: 0,
    delivery: 'pending',
    diff: null,
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
    branch: 'refs/aip/run1/run',
    createdAt: 1_000,
    finishedAt: null,
    finished: false,
    state: 'active',
    waiting: 0,
    dirtyWarning: false,
    autoDeliver: true,
    fromQueue: false,
    tags: [],
    counts: 'running 1',
    total: 1,
    usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.42 },
    split: null,
    delivery: { applied: 0, merged: 0, failed: 0, inProgress: false },
    resolver: null,
    diff: null,
    topology: topologyOf(),
    specialists: [],
    groups: [groupRow()],
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
    branch: 'refs/aip/run1/groups/login',
    worktree: '/w',
    question: null,
    questions: null,
    reason: null,
    warnings: [],
    conflictFiles: [],
    delivery: { state: 'pending', reason: null, files: [], conflicts: [], userEdits: [] },
    usage: null,
    diff: null,
    attempts: [
      {
        seq: 1,
        stepId: 'code',
        round: 1,
        specialist: 'coder',
        runtime: 'claude',
        model: 'sonnet',
        status: 'running',
        verdict: null,
        summary: null,
        feedback: null,
        reason: null,
        startedAt: 1_000,
        durationMs: 5_000,
        usage: null,
        denials: [],
        outsideChanges: [],
      },
    ],
    permissionHints: [],
    log: { seq: 1, lines: ['{"type":"system"}'] },
    ...overrides,
  };
}

export function workflowOf(overrides: Partial<WorkflowTopology> = {}): WorkflowTopology {
  return {
    id: 'feature',
    split: null,
    steps: topologyOf().steps.map(
      ({ groups: _g, attempts: _a, rejections: _r, usage: _u, ...step }) => step,
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
  return { id, name, color };
}

export function queueRun(id: string, overrides: Partial<QueueRunView> = {}): QueueRunView {
  return {
    id,
    title: id,
    state: 'active',
    workflow: 'feature',
    tags: [],
    createdAt: 0,
    groups: { done: 0, total: 1 },
    active: [],
    delivering: false,
    problem: null,
    ...overrides,
  };
}

export function queueOf(overrides: Partial<QueueView> = {}): QueueView {
  return {
    repository: '/repo',
    status: 'stopped',
    parallel: 1,
    autoDeliver: true,
    stop: null,
    items: [],
    runs: [],
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

export function queueItem(id: string, task: string, position: number, extra = {}) {
  return {
    id,
    position,
    workflow: 'feature',
    task,
    groups: null,
    title: null,
    autoDeliver: null,
    tags: [],
    skip: [],
    readiness: 'ready' as const,
    after: [],
    createdAt: 1,
    error: null,
    ...extra,
  };
}

export function settingsOf(overrides: Record<string, EditorSetting> = {}): EditorSetting[] {
  const base: EditorSetting[] = [
    { path: 'max', value: 3, file: null },
    { path: 'delivery.auto', value: true, file: null },
    { path: 'defaults.runtime', value: 'claude', file: null },
    { path: 'defaults.permissions', value: 'edit', file: null },
    { path: 'defaults.timeout', value: '30m', file: null },
    { path: 'defaults.allow_commands', value: [], file: null },
    { path: 'defaults.tools', value: [], file: null },
  ];
  return base.map((setting) => overrides[setting.path] ?? setting);
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
    repositories: vi.fn(async () => []),
    addRepository: vi.fn(async () => []),
    removeRepository: vi.fn(async () => []),
    workflows: vi.fn(async () => workflowsView()),
    group: vi.fn(async () => groupView()),
    transcript: vi.fn(async () => transcript),
    answer: vi.fn(async () => ({})),
    retry: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    apply: vi.fn(async () => ({ runId: 'run1', pending: false, groups: [] })),
    tags: vi.fn(async () => []),
    addTag: vi.fn(async (name: string) => [tagView(name)]),
    editTag: vi.fn(async () => []),
    removeTag: vi.fn(async () => []),
    setRunTags: vi.fn(async () => runView()),
    queue: vi.fn(async () => queueOf()),
    queueAdd: vi.fn(async () => ({ ...queueOf(), item: 'q1' })),
    queueEdit: vi.fn(async () => queueOf()),
    queueRemove: vi.fn(async () => queueOf()),
    queueRunNow: vi.fn(async () => ({
      runId: 'run9',
      branch: 'refs/aip/run9/run',
      groups: [],
      split: true,
      warnings: [],
    })),
    queueStart: vi.fn(async () => queueOf({ status: 'running' })),
    queuePause: vi.fn(async () => queueOf()),
    queueSettings: vi.fn(async () => queueOf()),
    config: vi.fn(async () => configView()),
    catalog: vi.fn(async () => catalogView()),
    writeSpecialist: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
    deleteSpecialist: vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' })),
    writeWorkflow: vi.fn(async () => ({ ok: true as const, revision: 'new', file: '/f' })),
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
    max?: number | null;
    running?: string[];
    waiting?: string[];
  } = {},
): Use {
  const item = (slug: string) => ({ slug, title: slug, step: 'code' });
  return {
    specialist,
    level: overrides.level ?? 'project',
    max: overrides.max ?? null,
    running: (overrides.running ?? []).map((slug) => ({ ...item(slug), startedAt: 1_000 })),
    waiting: (overrides.waiting ?? []).map(item),
  };
}
