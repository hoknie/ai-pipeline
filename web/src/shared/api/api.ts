import { ApiError, withRepository } from './http.ts';
import { configApi, type ConfigApi } from './configApi.ts';
import { queueApi, type QueueApi, type QueueSettingsPatch } from './queueApi.ts';
import { runActionsApi, type RunActionsApi } from './runActionsApi.ts';
import { runsApi, type RunsApi } from './runsApi.ts';
import { systemApi, type SystemApi } from './systemApi.ts';

export { ApiError, withRepository };
export type { QueueSettingsPatch };

export interface Api extends RunsApi, RunActionsApi, QueueApi, SystemApi, ConfigApi {
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
  };
  return api;
}

export const httpApi: Api = bound(null);
