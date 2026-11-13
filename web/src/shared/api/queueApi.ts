import type { QueueFields, QueuePatch, QueueView, RunCreated, TagView } from './types.ts';
import { call, enc, post, withRepository } from './http.ts';

export interface QueueSettingsPatch {
  parallel?: number;
  autopilot?: boolean;
  autoAnswer?: boolean;
  skipFailed?: boolean;
  /** `null`: the default text. */
  autopilotAnswer?: string | null;
  /** On a usage limit: wait for the reset, or stop. */
  onLimit?: 'wait' | 'stop';
  /** Replaces the passed lists (pipeline ids, tag ids); only while the queue is stopped. */
  filter?: { pipelines?: string[]; tags?: string[] };
}

export interface QueueApi {
  /** The tag catalog of the repository of the client. */
  tags(): Promise<TagView[]>;
  /** Creates a tag (the daemon picks the color when none is given); returns the catalog. */
  addTag(name: string, color?: string): Promise<TagView[]>;
  /** Renames and/or recolors a tag, addressed by its current name; returns the catalog. */
  editTag(tag: string, patch: { name?: string; color?: string }): Promise<TagView[]>;
  removeTag(tag: string): Promise<TagView[]>;
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
  /** Removes a skipped run from the skipped list of the queue. */
  queueDismiss(run: string, repository: string): Promise<QueueView>;
}

export function queueApi(at: (path: string) => string): QueueApi {
  return {
    tags: () => call(at('/api/tags')),
    addTag: (name, color) => post(at('/api/tags'), color ? { name, color } : { name }),
    editTag: (tag, patch) => post(at('/api/tags/edit'), { tag, ...patch }),
    removeTag: (tag) => post(at('/api/tags/remove'), { tag }),
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
    queueDismiss: (run, runRepository) =>
      post(withRepository('/api/queue/dismiss', runRepository), { run }),
  };
}
