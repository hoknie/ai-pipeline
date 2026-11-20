/** What an action is done to: it decides which attributes of the resource the rules can see. */
export type ResourceKind = 'global' | 'project' | 'run' | 'task';

export interface ActionInfo {
  name: string;
  description: string;
  resource: ResourceKind;
}

/** Every action a method of the daemon can be mapped to. */
export const ACTIONS: readonly ActionInfo[] = [
  {
    name: 'project.read',
    description: 'see a project, its runs, queue, tags and statistics',
    resource: 'project',
  },
  { name: 'project.add', description: 'add a project to the registry', resource: 'global' },
  {
    name: 'project.update',
    description: 'rename, recolor, disable or move a project',
    resource: 'global',
  },
  { name: 'project.remove', description: 'remove a project from the registry', resource: 'global' },
  { name: 'run.read', description: 'read a run: groups, logs, diffs, artifacts', resource: 'run' },
  { name: 'run.start', description: 'start a run', resource: 'project' },
  { name: 'run.cancel', description: 'cancel a run or a group', resource: 'run' },
  { name: 'run.retry', description: 'retry a run or a group', resource: 'run' },
  { name: 'run.skip', description: 'skip a step of a run', resource: 'run' },
  {
    name: 'run.configure',
    description: 'change the title, tags, variant, provider, pause or observer of a run',
    resource: 'run',
  },
  {
    name: 'run.answer',
    description: 'answer a question of a specialist or send it a message',
    resource: 'run',
  },
  {
    name: 'run.apply',
    description: 'deliver the result of a run or mark it delivered',
    resource: 'run',
  },
  { name: 'queue.read', description: 'read the queue of a project', resource: 'project' },
  { name: 'queue.add', description: 'add a task to a queue', resource: 'project' },
  { name: 'queue.edit', description: 'edit, remove, start now or return a task', resource: 'task' },
  { name: 'queue.control', description: 'start, pause or configure a queue', resource: 'project' },
  { name: 'tag.write', description: 'add, edit or remove a tag of a project', resource: 'project' },
  {
    name: 'config.read',
    description: 'read the configuration, the providers and the catalogs',
    resource: 'project',
  },
  {
    name: 'config.write',
    description: 'write the configuration of a project',
    resource: 'project',
  },
  {
    name: 'config.global.write',
    description: 'write the shared configuration and the observers',
    resource: 'global',
  },
  { name: 'stats.read', description: 'read the usage statistics', resource: 'project' },
  {
    name: 'stats.clear',
    description: 'clear the usage statistics of a project',
    resource: 'project',
  },
  { name: 'observers.read', description: 'read the history of the observers', resource: 'project' },
  {
    name: 'integration.read',
    description: 'list the integrations and their types',
    resource: 'global',
  },
  {
    name: 'integration.write',
    description: 'add, change or remove an integration and its secrets',
    resource: 'global',
  },
  {
    name: 'process.read',
    description: 'list the background processes of agents',
    resource: 'global',
  },
  {
    name: 'process.kill',
    description: 'kill a background process of an agent',
    resource: 'global',
  },
  { name: 'daemon.control', description: 'stop the daemon or the panel', resource: 'global' },
  { name: 'audit.read', description: 'read the audit journal', resource: 'global' },
  {
    name: 'users.manage',
    description: 'manage users, their attributes and login links',
    resource: 'global',
  },
];

const NAMES = new Set(ACTIONS.map((action) => action.name));

export function isAction(name: string): boolean {
  return NAMES.has(name);
}

export const actionNames = (): string[] => ACTIONS.map((action) => action.name);

/** The pattern `*` stands for any characters, a dot included; the rest is literal. */
export function patternMatches(pattern: string, action: string): boolean {
  if (!pattern.includes('*')) return pattern === action;
  const parts = pattern.split('*');
  let at = 0;
  for (const [index, part] of parts.entries()) {
    if (index === 0) {
      if (!action.startsWith(part)) return false;
      at = part.length;
    } else if (index === parts.length - 1) {
      return action.length - at >= part.length && action.endsWith(part);
    } else {
      const found = action.indexOf(part, at);
      if (found < 0) return false;
      at = found + part.length;
    }
  }
  return true;
}

/** The names of the catalog a pattern covers. */
export function actionsMatching(pattern: string): string[] {
  return actionNames().filter((name) => patternMatches(pattern, name));
}

function distance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      next[j] = Math.min(
        (next[j - 1] ?? 0) + 1,
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[right.length] ?? 0;
}

/** The names of the catalog that look like an unknown one: the same group or a near spelling. */
export function similarActions(name: string, known: readonly string[] = actionNames()): string[] {
  const group = name.split('.')[0] ?? name;
  const close = known.filter(
    (candidate) => candidate.startsWith(`${group}.`) || distance(candidate, name) <= 3,
  );
  return (close.length > 0 ? close : [...known]).slice(0, 6);
}
