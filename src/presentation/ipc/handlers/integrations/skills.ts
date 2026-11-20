import { invalid } from '../../../../platform/errors/index.ts';
import type { RegistrySkillView } from '../../contract/index.ts';

import type { HandlerTable } from '../types.ts';

/** The skills of a service registry for the CLI and the panel: by connection or by project. */
export const skillHandlers = {
  integration_skills: async (params, { services }): Promise<RegistrySkillView[]> => {
    const { skills } = services.serviceRegistry;
    const query = params.query ?? '';
    if (params.id !== undefined) return skills.list({ connection: params.id }, query);
    if (params.repository === undefined)
      throw invalid('ipc.invalid', 'pass a connection or a project');
    // A project that left the registry still stands as written: it may have a connection.
    const project = await services.registry
      .resolve(params.repository)
      .catch(() => params.repository);
    return skills.list({ project: project ?? params.repository }, query);
  },
} satisfies Partial<HandlerTable>;
