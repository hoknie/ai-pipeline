import { ApiError, withRepository } from './http.ts';
import { attachmentsApi, type AttachmentsApi } from './catalog/attachmentsApi.ts';
import { configApi, type ConfigApi } from './configApi.ts';
import { queueApi, type QueueApi, type QueueSettingsPatch } from './queueApi.ts';
import { runActionsApi, type RunActionsApi } from './runActionsApi.ts';
import { runsApi, type RunsApi } from './runsApi.ts';
import { statsApi, type StatsApi } from './statsApi.ts';
import { systemApi, type SystemApi } from './systemApi.ts';
import {
  observerHistory,
  type ObserverHistoryPage,
  type ObserverHistoryQuery,
} from './observerHistoryApi.ts';

export { ApiError, withRepository };
export type { QueueSettingsPatch };
export type { StatsQuery } from './statsApi.ts';

export type { UploadedFile } from './catalog/attachmentsApi.ts';

export interface Api
  extends RunsApi, RunActionsApi, QueueApi, SystemApi, ConfigApi, StatsApi, AttachmentsApi {
  observerHistory(query?: ObserverHistoryQuery): Promise<ObserverHistoryPage>;
  /**
   * The same API bound to a repository: queue, configuration and pipeline requests carry
   * `repository=<path>`. `null` is the repository `aip web` runs in.
   */
  forRepository(repository: string | null): Api;
}

function bound(repository: string | null): Api {
  const api: Api = {
    forRepository: (next) => (next === repository ? api : bound(next)),
    ...runsApi(),
    ...runActionsApi(),
    ...queueApi((path) => withRepository(path, repository)),
    ...systemApi(),
    ...configApi(repository),
    ...statsApi(),
    ...attachmentsApi(),
    observerHistory,
  };
  return api;
}

export const httpApi: Api = bound(null);
