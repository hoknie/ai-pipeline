import type { AccessActionsView, AccessCheckView } from '../../ipc/contract/index.ts';
import { type Style, plainStyle } from '../style.ts';
import { table } from '../table.ts';

const attributes = (values: Record<string, string[]>): string =>
  Object.entries(values)
    .map(([name, list]) => `${name}=${list.join(',')}`)
    .join('  ') || '—';

/** The catalog of the actions: name, what it is done to, what it does. */
export function formatAccessActions(view: AccessActionsView): string {
  return table([
    ['ACTION', 'RESOURCE', 'DESCRIPTION'],
    ...view.actions.map((action) => [action.name, action.resource, action.description]),
  ]);
}

const REASONS = {
  deny: 'a rule denies it',
  allow: 'a rule allows it',
  default: 'no rule allows it (refused by default)',
} as const;

/** The decision of `access_check`: the verdict, the rules behind it, what it looked at. */
export function formatAccessCheck(view: AccessCheckView, style: Style = plainStyle): string {
  const verdict = view.decision === 'allow' ? style.success('allow') : style.danger('deny');
  const lines = [`${verdict}  ${view.action} for ${view.user.email}: ${REASONS[view.reason]}`, ''];
  lines.push(
    view.matched.length === 0
      ? 'Matched rules: none'
      : `Matched rules: ${view.matched.map((match) => `${match.id} (${match.effect})`).join(', ')}`,
  );
  lines.push(`User attributes: ${attributes(view.user.attributes)}`);
  const { resource } = view;
  lines.push(
    `Resource: project=${resource.repository ?? '—'} author=${resource.author ?? '—'} pipeline=${resource.pipeline ?? '—'} tags=${resource.tags.join(',') || '—'}`,
  );
  return lines.join('\n');
}
