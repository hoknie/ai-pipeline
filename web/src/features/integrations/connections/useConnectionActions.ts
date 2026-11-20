import type { Api, IntegrationsOverview } from '../../../shared/api/api.ts';

/** Runs a change of the page, then loads again; true when it went through. */
export type Done = <T>(change: () => Promise<T>) => Promise<boolean>;

/** What a connection card and the form of a new one ask the daemon for. */
export function connectionActions(api: Api, done: Done) {
  return {
    onCreate: (connection: Parameters<Api['integrationAdd']>[0]) =>
      done(() => api.integrationAdd(connection)),
    onEdit: (id: string, change: { set: Record<string, string>; unset: string[] }) =>
      done(() => api.integrationEdit(id, change)),
    onEnabled: (id: string, enabled: boolean) => done(() => api.integrationEnabled(id, enabled)),
    onRemove: (id: string) => done(() => api.integrationRemove(id)),
    onCheck: (id: string) => done(() => api.integrationCheck(id)),
  };
}

/** The channel state of each connection by its id. */
export const channelsOf = (overview: IntegrationsOverview) =>
  new Map(overview.channels.map((one) => [one.connection, one]));
