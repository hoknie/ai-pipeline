import { z } from 'zod';
import { settingFieldOf } from '../../../feature/swarm-edit/types/index.ts';
import {
  settingValueSchema,
  type ConfigEditResult,
  type ObserversSetResult,
} from '../../ipc/contract/index.ts';
import { panel } from '../errors.ts';
import { Reply, editReply, parseBody, levelParam } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

const settingBody = z.object({
  value: settingValueSchema,
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

const settingsBody = z.object({
  values: z.record(z.string(), settingValueSchema),
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

export function settingsRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/observers$/,
      handle: () => call('observers', {}),
    },
    {
      method: 'PUT',
      pattern: /^\/api\/observers$/,
      handle: async (_match, body) => {
        const settings = parseBody(z.record(z.string(), z.unknown()), body);
        const result = (await call('observers_set', { settings })) as ObserversSetResult;
        if (result.ok) return new Reply(200, result.view);
        return new Reply(422, { errors: result.errors });
      },
    },
    {
      method: 'PUT',
      pattern: /^\/api\/config\/settings$/,
      handle: async (_match, body, repository) => {
        const { values, revision, level } = parseBody(settingsBody, body);
        const unknown = Object.keys(values).filter((path) => settingFieldOf(path) === undefined);
        if (unknown.length > 0) {
          throw panel('not_found', `setting \`${unknown.join('`, `')}\` cannot be written`);
        }
        if (Object.keys(values).length === 0) throw panel('invalid', 'values must not be empty');
        return editReply(
          (await call('config_settings', {
            repository,
            values,
            revision,
            level: level ?? 'global',
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/settings/${segment}$`),
      handle: async ([path], body, repository) => {
        const known = path !== undefined && settingFieldOf(path) !== undefined ? path : undefined;
        if (known === undefined) {
          throw panel('not_found', `setting \`${path ?? ''}\` cannot be written`);
        }
        const { value, revision, level } = parseBody(settingBody, body);
        return editReply(
          (await call('config_setting', {
            repository,
            path: known,
            value,
            revision,
            level: level ?? 'global',
          })) as ConfigEditResult,
        );
      },
    },
  ];
}
