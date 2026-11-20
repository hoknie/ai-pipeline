import type { AccessRule } from '../../swarm-config/types/index.ts';
import { ACTIONS, patternMatches } from './actions.ts';

/** The actions the role `developer` lacks: the shared settings, the registry, the accounts, the audit. */
export const DEVELOPER_EXCLUDED: readonly string[] = [
  'config.global.write',
  'project.add',
  'project.update',
  'project.remove',
  'users.manage',
  'audit.read',
  'stats.clear',
];

/** The actions the role `viewer` has: reading, except the audit journal of all projects. */
const VIEWER_EXCLUDED: readonly string[] = ['audit.read'];

const names = (): string[] => ACTIONS.map((action) => action.name);

/** The presets of the roles as rules: `admin` all, `developer` all but the shared ones, `viewer` reading. */
export function presetRules(): AccessRule[] {
  return [
    {
      id: 'preset:admin',
      effect: 'allow',
      actions: ['*'],
      subject: { role: ['admin'] },
      resource: {},
    },
    {
      id: 'preset:developer',
      effect: 'allow',
      actions: names().filter((name) => !DEVELOPER_EXCLUDED.includes(name)),
      subject: { role: ['developer'] },
      resource: {},
    },
    {
      id: 'preset:viewer',
      effect: 'allow',
      actions: names().filter(
        (name) => patternMatches('*.read', name) && !VIEWER_EXCLUDED.includes(name),
      ),
      subject: { role: ['viewer'] },
      resource: {},
    },
  ];
}
