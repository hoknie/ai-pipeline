import type { RuleParam } from './descriptor.ts';
import { registryProjectUrl } from './link.ts';

/** The event types that ask for a task, and the parameter of the connection that names its pipeline. */
export const RULE_OF_EVENT: Readonly<Record<string, RuleParam>> = {
  'deployment.drift': 'on_deployment_drift',
  'link.check_failed': 'on_link_check_failed',
  'repo_sync.failed': 'on_repo_sync_failed',
};

/** The events that say a problem is gone: they never ask for a task. */
export const RECOVERY_EVENTS: readonly string[] = [
  'deployment.drift_resolved',
  'link.check_recovered',
  'repo_sync.recovered',
];

/** Why a checked event asks for nothing; each is a static word. */
export type IgnoredReason =
  'no_rule' | 'recovery' | 'unsupported' | 'malformed' | 'no_link' | 'ambiguous_link';

/** The longest text of one field of an event that goes into a task. */
export const FIELD_LIMIT = 500;

/** The verdict of the rules on the type of an event. */
export type Rule = { pipeline: string } | { ignore: IgnoredReason };

export function ruleOf(type: string, params: Readonly<Record<string, string>>): Rule {
  if (RECOVERY_EVENTS.includes(type)) return { ignore: 'recovery' };
  const param = Object.hasOwn(RULE_OF_EVENT, type) ? RULE_OF_EVENT[type] : undefined;
  if (param === undefined) return { ignore: 'unsupported' };
  const pipeline = params[param];
  return pipeline === undefined || pipeline === '' ? { ignore: 'no_rule' } : { pipeline };
}

/** The known text fields of `data` of an event type, as labelled lines of the task. */
const FIELDS: Readonly<Record<string, readonly (readonly [string, readonly string[]])[]>> = {
  'deployment.drift': [
    ['Environment', ['environment']],
    ['Expected version', ['expected_version']],
    ['Actual version', ['actual_version']],
  ],
  'link.check_failed': [
    ['Link', ['link', 'url']],
    ['Status', ['link', 'status']],
  ],
  'repo_sync.failed': [
    ['Repository', ['repo_url']],
    ['Error', ['error']],
  ],
};

function pick(data: unknown, keys: readonly string[]): string | undefined {
  let value: unknown = data;
  for (const key of keys) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== 'string' || value === '') return undefined;
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  return clean.length > FIELD_LIMIT ? `${clean.slice(0, FIELD_LIMIT)}…` : clean;
}

/** The title and the text of the task for a verified event; no delivery metadata goes in. */
export function taskOf(
  event: { type: string; data: unknown },
  base: string | null,
  path: string,
): { title: string; task: string } {
  const lines = [`Registry event: ${event.type}`, `Project in the registry: ${path}`];
  if (base !== null) lines.push(`Link: ${registryProjectUrl(base, path)}`);
  for (const [label, keys] of (Object.hasOwn(FIELDS, event.type)
    ? FIELDS[event.type]
    : undefined) ?? []) {
    const value = pick(event.data, keys);
    if (value !== undefined) lines.push(`${label}: ${value}`);
  }
  const title = `Registry: ${event.type} — ${path}`.slice(0, 200);
  return { title, task: lines.join('\n') };
}
