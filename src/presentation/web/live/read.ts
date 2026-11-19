import { request } from '../../ipc/client/index.ts';
import type { Method, ParamsOf } from '../../ipc/contract/index.ts';
import type { WebOptions } from '../options.ts';
import { requestRepository } from '../request.ts';

import type { ReadTopic } from './protocol.ts';

/** How many lines of the log the view of a group carries, as the panel asks for it. */
const GROUP_TAIL_LINES = 200;

/** Reads the data of a topic with the method of the daemon the matching request of the API uses. */
export function topicReader(
  socket: string,
  options: Pick<WebOptions, 'repository' | 'defaultRepository'>,
): ReadTopic {
  return async (topic, actor) => {
    const call = <M extends Method>(method: M, params: ParamsOf<M>) =>
      request(socket, method, params, undefined, actor);
    if (topic.kind === 'transcript') {
      const { runId, group, seq, after } = topic;
      return call('transcript', { runId, group, seq, ...(after === undefined ? {} : { after }) });
    }
    if (topic.kind === 'group') {
      return call('group', { runId: topic.runId, group: topic.group, tailLines: GROUP_TAIL_LINES });
    }
    if (topic.kind === 'group_spec') {
      return call('group_spec', { runId: topic.runId, group: topic.group });
    }
    const url = new URL('http://panel/api/config/providers');
    if (topic.repository !== undefined) url.searchParams.set('repository', topic.repository);
    const repository = await requestRepository(url, options);
    return call('config_providers', {
      repository,
      ...(topic.level === 'global' ? { level: 'global' as const } : {}),
    });
  };
}
