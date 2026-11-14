import type { Style } from '../../format/index.ts';

import { claudeMcp, claudePlugin, opencodeMcp, prerequisites } from './actions.ts';
import { resolveAipCommand } from './system.ts';
import type { Outcome, OutcomeStatus, SetupAction, SetupDeps, SetupOptions } from './types.ts';

export function planSetup(options: SetupOptions, deps: SetupDeps): SetupAction[] {
  const command = resolveAipCommand(deps);
  const actions: SetupAction[] = [prerequisites(deps)];
  if (options.claude) {
    actions.push(claudeMcp(deps, command));
    if (options.plugin) actions.push(claudePlugin(deps));
  }
  if (options.opencode) actions.push(opencodeMcp(deps, command));
  return actions;
}

/** Runs the actions one by one; a failure of one does not stop the others. */
export async function runSetup(
  actions: SetupAction[],
  options: Pick<SetupOptions, 'dryRun' | 'force'>,
  report: (outcome: Outcome) => void = () => undefined,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const action of actions) {
    const base = { id: action.id, label: action.label };
    let outcome: Outcome;
    try {
      const checked = await action.check();
      if (checked.state === 'configured') {
        outcome = { ...base, status: 'configured', message: 'already set up' };
      } else if (checked.state === 'skip') {
        outcome = { ...base, status: 'skipped', message: checked.reason };
      } else if (checked.state === 'error') {
        outcome = { ...base, status: 'failed', message: checked.reason };
      } else if (checked.state === 'differs' && !options.force) {
        outcome = { ...base, status: 'differs', message: checked.detail };
      } else if (options.dryRun) {
        outcome = { ...base, status: 'planned', message: `would ${action.plan}` };
      } else {
        await action.apply(checked.state === 'differs');
        outcome = { ...base, status: 'done', message: 'set up' };
      }
    } catch (error) {
      outcome = { ...base, status: 'failed', message: (error as Error).message };
    }
    outcomes.push(outcome);
    report(outcome);
  }
  return outcomes;
}

const BADGES: Record<
  OutcomeStatus,
  { badge: string; role: Exclude<keyof Style, 'rich' | 'columns'> }
> = {
  done: { badge: '✓', role: 'success' },
  configured: { badge: '✓', role: 'success' },
  planned: { badge: '·', role: 'command' },
  skipped: { badge: '-', role: 'muted' },
  differs: { badge: '!', role: 'warning' },
  failed: { badge: '✗', role: 'danger' },
};

export function formatOutcome(outcome: Outcome, style: Style): string {
  const { badge, role } = BADGES[outcome.status];
  return `${style[role](badge)} ${outcome.label}: ${outcome.message}`;
}
