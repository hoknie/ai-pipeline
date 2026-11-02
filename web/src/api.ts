import type {
  ApplyResult,
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigEditorResponse,
  ConfigPreview,
  GroupView,
  QueueFields,
  QueuePatch,
  QueueView,
  RepositoryView,
  RunCreated,
  RunView,
  TagView,
  Transcript,
  WorkflowsView,
  WriteLevel,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface QueueSettingsPatch {
  parallel?: number;
  autopilot?: boolean;
  skipFailed?: boolean;
}

export interface Api {
  /**
   * The same API bound to a repository: queue, configuration and workflow requests carry
   * `repository=<path>`. `null` is the repository `aip web` runs in.
   */
  forRepository(repository: string | null): Api;
  runs(): Promise<RunView[]>;
  /** The daemon's list of repositories with counters. */
  repositories(): Promise<RepositoryView[]>;
  /** Adds the git repository of a path to the daemon's list; returns the new list. */
  addRepository(path: string): Promise<RepositoryView[]>;
  /** Removes a repository from the list; the daemon refuses while it has work. */
  removeRepository(path: string): Promise<RepositoryView[]>;
  /** Workflows of the bound repository, or of the one given. */
  workflows(repository?: string): Promise<WorkflowsView>;
  group(runId: string, group: string): Promise<GroupView>;
  transcript(runId: string, group: string, seq: number, after: number): Promise<Transcript>;
  answer(runId: string, group: string, answer: string): Promise<unknown>;
  retry(runId: string, group: string): Promise<unknown>;
  cancel(runId: string, group?: string): Promise<unknown>;
  apply(runId: string, force: boolean): Promise<ApplyResult>;
  /** The tag catalog (shared by all repositories). */
  tags(): Promise<TagView[]>;
  /** Creates a tag (the daemon picks the color when none is given); returns the catalog. */
  addTag(name: string, color?: string): Promise<TagView[]>;
  /** Renames and/or recolors a tag, addressed by its current name; returns the catalog. */
  editTag(tag: string, patch: { name?: string; color?: string }): Promise<TagView[]>;
  removeTag(tag: string): Promise<TagView[]>;
  /** Adds and removes tags (by name) of a run in any state. */
  setRunTags(runId: string, change: { add?: string[]; remove?: string[] }): Promise<RunView>;
  /** The queue of the bound repository. */
  queue(): Promise<QueueView>;
  queueAdd(fields: QueueFields): Promise<QueueView & { item: string }>;
  queueEdit(item: string, patch: QueuePatch): Promise<QueueView>;
  queueRemove(item: string): Promise<QueueView>;
  queueRunNow(item: string): Promise<RunCreated>;
  queueStart(parallel?: number): Promise<QueueView>;
  queuePause(): Promise<QueueView>;
  queueSettings(patch: QueueSettingsPatch): Promise<QueueView>;
  /** The configuration of the bound repository, for the editors. */
  config(): Promise<ConfigEditorResponse>;
  /** Tools and skills a specialist can name, per runtime. */
  catalog(): Promise<ConfigCatalogResponse>;
  /** Writes a specialist file; problems with the edit come back as a result, not an error. */
  writeSpecialist(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deleteSpecialist(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** Writes one general setting (`null` removes it); problems come back as a result. */
  writeSetting(
    path: string,
    value: boolean | null,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  writeWorkflow(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deleteWorkflow(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** The graph and the errors of a draft workflow; nothing is written. */
  previewWorkflow(
    id: string,
    value: Record<string, unknown>,
    level?: WriteLevel,
  ): Promise<ConfigPreview>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, body.error ?? response.statusText);
  return body as T;
}

function post<T>(path: string, body: unknown = {}): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const enc = encodeURIComponent;
const levelQuery = (level?: WriteLevel) => (level ? `&level=${level}` : '');

/** 200, 422 (errors) and 409 (conflict) are outcomes of an edit; anything else is a failure. */
async function edit(path: string, init: RequestInit): Promise<ConfigEditResult> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 200) return body as unknown as ConfigEditResult;
  if (response.status === 422) {
    return {
      ok: false,
      reason: 'invalid',
      errors: (body.errors ?? []) as never,
      references: (body.references ?? []) as never,
    };
  }
  if (response.status === 409) {
    return { ok: false, reason: 'conflict', message: String(body.error ?? 'conflict') };
  }
  throw new ApiError(response.status, String(body.error ?? response.statusText));
}

/** The address with `repository=<path>` added (`null` leaves it as it is). */
export function withRepository(path: string, repository: string | null): string {
  if (repository === null) return path;
  return `${path}${path.includes('?') ? '&' : '?'}repository=${enc(repository)}`;
}

function bound(repository: string | null): Api {
  const at = (path: string) => withRepository(path, repository);
  const api: Api = {
    forRepository: (next) => (next === repository ? api : bound(next)),
    runs: () => call('/api/runs'),
    repositories: () => call('/api/repositories'),
    addRepository: (path) => post('/api/repositories', { path }),
    removeRepository: (path) =>
      call(`/api/repositories?repository=${enc(path)}`, { method: 'DELETE' }),
    workflows: (other) => call(withRepository('/api/workflows', other ?? repository)),
    group: (runId, group) => call(`/api/runs/${enc(runId)}/groups/${enc(group)}?tail=200`),
    transcript: (runId, group, seq, after) =>
      call(`/api/runs/${enc(runId)}/groups/${enc(group)}/transcript?seq=${seq}&after=${after}`),
    answer: (runId, group, answer) =>
      post(`/api/runs/${enc(runId)}/groups/${enc(group)}/answer`, { answer }),
    retry: (runId, group) => post(`/api/runs/${enc(runId)}/groups/${enc(group)}/retry`),
    cancel: (runId, group) =>
      group
        ? post(`/api/runs/${enc(runId)}/groups/${enc(group)}/cancel`)
        : post(`/api/runs/${enc(runId)}/cancel`),
    apply: (runId, force) => post(`/api/runs/${enc(runId)}/apply`, force ? { force: true } : {}),
    tags: () => call('/api/tags'),
    addTag: (name, color) => post('/api/tags', color ? { name, color } : { name }),
    editTag: (tag, patch) => post('/api/tags/edit', { tag, ...patch }),
    removeTag: (tag) => post('/api/tags/remove', { tag }),
    setRunTags: (runId, change) => post(`/api/runs/${enc(runId)}/tags`, change),
    queue: () => call(at('/api/queue')),
    queueAdd: (fields) => post(at('/api/queue/items'), fields),
    queueEdit: (item, patch) => post(at(`/api/queue/items/${enc(item)}`), patch),
    queueRemove: (item) => post(at(`/api/queue/items/${enc(item)}/remove`)),
    queueRunNow: (item) => post(at(`/api/queue/items/${enc(item)}/run`)),
    queueStart: (parallel) =>
      post(at('/api/queue/start'), parallel === undefined ? {} : { parallel }),
    queuePause: () => post(at('/api/queue/pause')),
    queueSettings: (patch) => post(at('/api/queue/settings'), patch),
    config: () => call(at('/api/config')),
    catalog: () => call(at('/api/config/catalog')),
    writeSpecialist: (id, value, revision, level) =>
      edit(at(`/api/config/specialists/${enc(id)}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, revision, ...(level ? { level } : {}) }),
      }),
    writeSetting: (path, value, revision, level) =>
      edit(at(`/api/config/settings/${enc(path)}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, revision, ...(level ? { level } : {}) }),
      }),
    deleteSpecialist: (id, revision, level) =>
      edit(at(`/api/config/specialists/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    writeWorkflow: (id, value, revision, level) =>
      edit(at(`/api/config/workflows/${enc(id)}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, revision, ...(level ? { level } : {}) }),
      }),
    deleteWorkflow: (id, revision, level) =>
      edit(at(`/api/config/workflows/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    previewWorkflow: (id, value, level) =>
      post(at(`/api/config/workflows/${enc(id)}/preview`), {
        value,
        ...(level ? { level } : {}),
      }),
  };
  return api;
}

export const httpApi: Api = bound(null);
