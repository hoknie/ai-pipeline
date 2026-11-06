import {
  parseObserversView,
  type ObserverSettings,
  type ObserversResult,
  type ObserversView,
} from './observerTypes.ts';
import type { SystemStagesResponse } from './pipelineEntries.ts';
import type {
  ApplyResult,
  ArtifactView,
  BackgroundProcessesView,
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigEditorResponse,
  ConfigPreview,
  FileDiffView,
  GroupSpecView,
  GroupView,
  QueueFields,
  QueuePatch,
  QueueView,
  RepositoryView,
  RunCreated,
  SettingValue,
  RunView,
  SharedSpecialistsView,
  SpecialistTagsView,
  SpecialistsImportResult,
  SharedPipelinesView,
  PipelinesImportResult,
  SystemView,
  TagView,
  Transcript,
  PipelinesView,
  WriteLevel,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable reason of the refusal, such as `daemon_busy`. */
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface QueueSettingsPatch {
  parallel?: number;
  autopilot?: boolean;
  autoAnswer?: boolean;
  skipFailed?: boolean;
  /** `null`: the default text. */
  autopilotAnswer?: string | null;
  /** On a usage limit: wait for the reset, or stop. */
  onLimit?: 'wait' | 'stop';
}

export interface Api {
  /**
   * The same API bound to a repository: queue, configuration and pipeline requests carry
   * `repository=<path>`. `null` is the repository `aip web` runs in.
   */
  forRepository(repository: string | null): Api;
  runs(): Promise<RunView[]>;
  /** A page of finished runs after the cursor `before` (none: the newest); `next` is null at the end. */
  finishedRuns(before?: string): Promise<{ runs: RunView[]; next: string | null }>;
  /** One run by id, also one the list no longer carries; 404 when the daemon does not know it. */
  run(runId: string): Promise<RunView>;
  /** The daemon's list of repositories with counters. */
  repositories(): Promise<RepositoryView[]>;
  /** Adds the git repository of a path to the daemon's list; returns the new list. */
  addRepository(path: string): Promise<RepositoryView[]>;
  /** Removes a repository from the list; the daemon refuses while it has work. */
  removeRepository(path: string): Promise<RepositoryView[]>;
  /** Pipelines of the bound repository, or of the one given. */
  pipelines(repository?: string): Promise<PipelinesView>;
  group(runId: string, group: string): Promise<GroupView>;
  groupSpec(runId: string, group: string): Promise<GroupSpecView | null>;
  transcript(runId: string, group: string, seq: number, after: number): Promise<Transcript>;
  /** Diff of one changed file of a group with a few lines of context. */
  fileDiff(runId: string, group: string, path: string): Promise<FileDiffView>;
  /** Artifacts the specialists published for a group, newest first. */
  groupArtifacts(runId: string, group: string): Promise<ArtifactView[]>;
  /** Address of an artifact: the download, or with `inline` the text for a preview. */
  artifactUrl(runId: string, group: string, id: string, inline?: boolean): string;
  /** The text of a `.md` or `.log` artifact. */
  artifactText(runId: string, group: string, id: string): Promise<string>;
  /** The patch of the merged groups of a run, for `git apply`. */
  runPatch(runId: string): Promise<{ blob: Blob; fileName: string }>;
  answer(runId: string, group: string, answer: string): Promise<unknown>;
  /** Interrupts the running attempt `seq`; the step continues in its session with the text. */
  message(runId: string, group: string, seq: number, text: string): Promise<unknown>;
  /** `refreshConfig` first takes the specialists of the current configuration into the run. */
  retry(runId: string, group: string, options?: { refreshConfig?: boolean }): Promise<unknown>;
  /** Skips a step of the run (or brings it back with `skip=false`); returns the run. */
  skipStep(runId: string, step: string, skip: boolean): Promise<unknown>;
  cancel(runId: string, group?: string): Promise<unknown>;
  apply(runId: string, force: boolean): Promise<ApplyResult>;
  /** Marks merged groups delivered after the user merged them by hand; nothing is applied. */
  markDelivered(runId: string, groups?: string[]): Promise<ApplyResult>;
  /** Processes started by agents of the daemon (all repositories). */
  processes(): Promise<BackgroundProcessesView>;
  /** Terminates a background process and its children; the daemon refuses any other PID. */
  killProcess(pid: number): Promise<unknown>;
  /** The tag catalog of the repository of the client. */
  tags(): Promise<TagView[]>;
  /** Creates a tag (the daemon picks the color when none is given); returns the catalog. */
  addTag(name: string, color?: string): Promise<TagView[]>;
  /** Renames and/or recolors a tag, addressed by its current name; returns the catalog. */
  editTag(tag: string, patch: { name?: string; color?: string }): Promise<TagView[]>;
  removeTag(tag: string): Promise<TagView[]>;
  /** Replaces the title of a run in any state; the name stays. */
  setRunTitle(runId: string, title: string): Promise<RunView>;
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
  /** Puts a run back first in the queue of its repository; it continues where it stopped. */
  queueReturn(run: string, repository: string): Promise<QueueView & { item: string }>;
  /** Pauses an unfinished run: its running step stops (it continues in the same session) and the run goes to the end of the queue. */
  pauseRun(run: string, repository: string): Promise<QueueView & { item: string }>;
  /** Removes a skipped run from the skipped list of the queue. */
  queueDismiss(run: string, repository: string): Promise<QueueView>;
  /** State of the daemon and of the panel itself. */
  system(): Promise<SystemView>;
  /** Restarts the panel; the answer comes before it goes down. */
  restartWeb(): Promise<void>;
  /** Restarts the daemon; refused with code `daemon_busy` while agents run, unless `force`. */
  restartDaemon(force: boolean): Promise<void>;
  /**
   * Stops the daemon; the panel stays up in a stand-in process. Refused with code `daemon_busy`
   * while agents run, unless `force`.
   */
  stopDaemon(force: boolean): Promise<void>;
  /** Starts the daemon from the stand-in panel; the daemon takes the panel back. */
  startDaemon(): Promise<void>;
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
  /** The shared specialists with the repositories of the registry that use them. */
  sharedSpecialists(): Promise<SharedSpecialistsView>;
  /** The specialists of the shared level and of every repository, with their tags. */
  specialistTags(): Promise<SpecialistTagsView>;
  /** Copies project specialists of another repository into the bound one. */
  importSpecialists(source: string, slugs: string[]): Promise<SpecialistsImportResult>;
  /** The shared pipelines with the repositories of the registry that use them. */
  sharedPipelines(): Promise<SharedPipelinesView>;
  /** Copies project pipelines of another repository into the bound one. */
  importPipelines(source: string, ids: string[]): Promise<PipelinesImportResult>;
  /** Writes one general setting (`null` removes it); problems come back as a result. */
  writeSetting(
    path: string,
    value: SettingValue,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  /** Writes several settings of one level in one go (`null` removes a field). */
  writeSettings(
    values: Record<string, SettingValue>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  writePipeline(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deletePipeline(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** The graph and the errors of a draft pipeline; nothing is written. */
  previewPipeline(
    id: string,
    value: Record<string, unknown>,
    level?: WriteLevel,
  ): Promise<ConfigPreview>;
  /** Writes an action file; problems with the edit come back as a result, not an error. */
  writeAction(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  /** Refused with the places that name the action when a point still uses it. */
  deleteAction(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** The built-in stages of the pipeline with their tasks and settings. */
  systemStages(): Promise<SystemStagesResponse>;
  /** The settings of the observers and their running repairs. */
  observers(): Promise<ObserversView>;
  /** Saves the settings of the observers; wrong fields come back as a result, not an error. */
  setObservers(settings: ObserverSettings): Promise<ObserversResult>;
  /** Forbids (`enabled: false`) or gives back the observer in one run. */
  setRunObserver(run: string, repository: string, enabled: boolean): Promise<unknown>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok)
    throw new ApiError(response.status, body.error ?? response.statusText, body.code);
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

/** The view in an answer; an answer that is not one is a failure. */
function viewOf(body: unknown): ObserversView {
  const view = parseObserversView(body);
  if (view === null) throw new ApiError(502, 'Malformed answer of /api/observers');
  return view;
}

/** 200 is the saved view, 422 the errors of fields; anything else is a failure. */
async function saveObservers(settings: ObserverSettings): Promise<ObserversResult> {
  const response = await fetch('/api/observers', {
    credentials: 'same-origin',
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 200) return { ok: true, view: viewOf(body) };
  if (response.status === 422)
    return { ok: false, errors: (body.errors ?? []) as { path: string; message: string }[] };
  throw new ApiError(response.status, String(body.error ?? response.statusText));
}

/** The address with `repository=<path>` added (`null` leaves it as it is). */
/** How many finished runs one page of the run list loads. */
const FINISHED_PAGE = 15;

export function withRepository(path: string, repository: string | null): string {
  if (repository === null) return path;
  return `${path}${path.includes('?') ? '&' : '?'}repository=${enc(repository)}`;
}

function bound(repository: string | null): Api {
  const at = (path: string) => withRepository(path, repository);
  const api: Api = {
    forRepository: (next) => (next === repository ? api : bound(next)),
    runs: () => call('/api/runs'),
    finishedRuns: (before) =>
      call(`/api/finished-runs?limit=${FINISHED_PAGE}${before ? `&before=${enc(before)}` : ''}`),
    run: (runId) => call(`/api/runs/${enc(runId)}`),
    repositories: () => call('/api/repositories'),
    addRepository: (path) => post('/api/repositories', { path }),
    removeRepository: (path) =>
      call(`/api/repositories?repository=${enc(path)}`, { method: 'DELETE' }),
    pipelines: (other) => call(withRepository('/api/pipelines', other ?? repository)),
    group: (runId, group) => call(`/api/runs/${enc(runId)}/groups/${enc(group)}?tail=200`),
    groupSpec: (runId, group) => call(`/api/runs/${enc(runId)}/groups/${enc(group)}/spec`),
    transcript: (runId, group, seq, after) =>
      call(`/api/runs/${enc(runId)}/groups/${enc(group)}/transcript?seq=${seq}&after=${after}`),
    fileDiff: (runId, group, path) =>
      call(`/api/runs/${enc(runId)}/groups/${enc(group)}/diff?path=${enc(path)}`),
    groupArtifacts: async (runId, group) =>
      (
        await call<{ artifacts: ArtifactView[] }>(
          `/api/runs/${enc(runId)}/groups/${enc(group)}/artifacts`,
        )
      ).artifacts,
    artifactUrl: (runId, group, id, inline = false) =>
      `/api/runs/${enc(runId)}/groups/${enc(group)}/artifacts/${enc(id)}${inline ? '?inline=1' : ''}`,
    artifactText: async (runId, group, id) => {
      const response = await fetch(api.artifactUrl(runId, group, id, true), {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body.error ?? response.statusText);
      }
      return response.text();
    },
    runPatch: async (runId) => {
      const response = await fetch(`/api/runs/${enc(runId)}/patch`, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body.error ?? response.statusText);
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
      return { blob: await response.blob(), fileName: name?.[1] ?? `${runId}.patch` };
    },
    message: (runId, group, seq, text) =>
      post(`/api/runs/${enc(runId)}/groups/${enc(group)}/message`, { seq, text }),
    answer: (runId, group, answer) =>
      post(`/api/runs/${enc(runId)}/groups/${enc(group)}/answer`, { answer }),
    skipStep: (runId, step, skip) => post(`/api/runs/${enc(runId)}/skip`, { step, skip }),
    retry: (runId, group, options) =>
      post(
        `/api/runs/${enc(runId)}/groups/${enc(group)}/retry`,
        options?.refreshConfig ? { refreshConfig: true } : {},
      ),
    cancel: (runId, group) =>
      group
        ? post(`/api/runs/${enc(runId)}/groups/${enc(group)}/cancel`)
        : post(`/api/runs/${enc(runId)}/cancel`),
    apply: (runId, force) => post(`/api/runs/${enc(runId)}/apply`, force ? { force: true } : {}),
    markDelivered: (runId, groups) =>
      post(`/api/runs/${enc(runId)}/delivered`, groups ? { groups } : {}),
    processes: () => call('/api/processes'),
    killProcess: (pid) => post(`/api/processes/${pid}/kill`),
    tags: () => call(at('/api/tags')),
    addTag: (name, color) => post(at('/api/tags'), color ? { name, color } : { name }),
    editTag: (tag, patch) => post(at('/api/tags/edit'), { tag, ...patch }),
    removeTag: (tag) => post(at('/api/tags/remove'), { tag }),
    setRunTitle: (runId, title) => post(`/api/runs/${enc(runId)}/title`, { title }),
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
    queueReturn: (run, runRepository) =>
      post(withRepository('/api/queue/return', runRepository), { run }),
    pauseRun: (run, runRepository) =>
      post(withRepository(`/api/runs/${enc(run)}/pause`, runRepository)),
    queueDismiss: (run, runRepository) =>
      post(withRepository('/api/queue/dismiss', runRepository), { run }),
    system: () => call('/api/system'),
    restartWeb: async () => void (await post('/api/system/web/restart')),
    restartDaemon: async (force) =>
      void (await post('/api/system/daemon/restart', force ? { force: true } : {})),
    stopDaemon: async (force) =>
      void (await post('/api/system/daemon/stop', force ? { force: true } : {})),
    startDaemon: async () => void (await post('/api/system/daemon/start')),
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
    writeSettings: (values, revision, level) =>
      edit(at('/api/config/settings'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values, revision, ...(level ? { level } : {}) }),
      }),
    deleteSpecialist: (id, revision, level) =>
      edit(at(`/api/config/specialists/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    sharedSpecialists: () => call('/api/shared-specialists'),
    specialistTags: () => call('/api/specialist-tags'),
    importSpecialists: async (source, slugs) =>
      (await edit(at('/api/config/specialists/import'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, slugs }),
      })) as unknown as SpecialistsImportResult,
    sharedPipelines: () => call('/api/shared-pipelines'),
    importPipelines: async (source, ids) =>
      (await edit(at('/api/config/pipelines/import'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, ids }),
      })) as unknown as PipelinesImportResult,
    writePipeline: (id, value, revision, level) =>
      edit(at(`/api/config/pipelines/${enc(id)}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, revision, ...(level ? { level } : {}) }),
      }),
    deletePipeline: (id, revision, level) =>
      edit(at(`/api/config/pipelines/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    writeAction: (id, value, revision, level) =>
      edit(at(`/api/config/actions/${enc(id)}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, revision, ...(level ? { level } : {}) }),
      }),
    deleteAction: (id, revision, level) =>
      edit(at(`/api/config/actions/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    systemStages: () => call(at('/api/system-stages')),
    observers: async () => viewOf(await call<unknown>('/api/observers')),
    setObservers: saveObservers,
    setRunObserver: (run, runRepository, enabled) =>
      post(withRepository(`/api/runs/${enc(run)}/observer`, runRepository), { enabled }),
    previewPipeline: (id, value, level) =>
      post(at(`/api/config/pipelines/${enc(id)}/preview`), {
        value,
        ...(level ? { level } : {}),
      }),
  };
  return api;
}

export const httpApi: Api = bound(null);
