import type { ProbeScore, ProbeVersus, ProbeView } from '../../ipc/contract/index.ts';
import { type Style, plainStyle } from '../style.ts';

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** The objective signal of one candidate, e.g. `clean 2/3 (67%), conflicts 0, denials 1`. */
function signalLine(score: ProbeScore, baseline: boolean): string {
  const mark = baseline ? ' (baseline)' : '';
  const errors = score.errors === 0 ? '' : `, check errors ${score.errors}`;
  return `\`${score.candidate}\`${mark}: clean ${score.clean}/${score.finished - score.errors} (${percent(score.cleanRate)}), conflicts ${score.conflicts}, denials ${score.denials}, outside changes ${score.outsideChanges}${errors}, tokens ${score.tokens}`;
}

/** One paired comparison with the baseline and why it does or does not count. */
function versusLine(entry: ProbeVersus): string {
  const trust = entry.significant ? 'significant' : 'not significant';
  return `\`${entry.candidate}\` vs \`${entry.baseline}\`: ${entry.wins} win(s), ${entry.losses} loss(es), ${entry.ties} tie(s), p=${entry.pValue.toFixed(3)} (${trust})`;
}

function budgetLine(view: ProbeView): string {
  const { experiment, comparison } = view;
  const tokens = experiment.budget.maxTokens === null ? '' : ` of ${experiment.budget.maxTokens}`;
  return `Created ${comparison.spent.runs}/${experiment.planned} planned run(s), limit ${experiment.budget.maxRuns}; spent ${comparison.spent.tokens} token(s)${tokens}`;
}

/** The experiment, its objective signals, the comparison and the proposal it reaches. */
export function formatProbe(view: ProbeView, style: Style = plainStyle): string {
  const { experiment, comparison } = view;
  const baseline = experiment.candidates[0] ?? 'default';
  const lines = [
    `Probe ${style.accent(experiment.id)} — ${view.status}`,
    `Source: run ${experiment.sourceRun}, group ${style.accent(experiment.sourceGroup)}, base ${experiment.baseCommit}`,
    `Candidates: ${experiment.candidates.map((candidate) => `\`${candidate}\``).join(', ')} · ${experiment.repetitions} repetition(s) each · baseline \`${baseline}\``,
    budgetLine(view),
    ...comparison.scores.map((score) => `  ${signalLine(score, score.candidate === baseline)}`),
  ];
  if (comparison.versus.length > 0) {
    lines.push('Comparison:');
    for (const entry of comparison.versus) lines.push(`  ${versusLine(entry)}`);
  }
  lines.push(
    `Outcome: ${comparison.winner === null ? 'no winner' : `winner \`${comparison.winner}\``}`,
  );
  lines.push(style.muted(comparison.reason));
  for (const warning of view.warnings) lines.push(style.muted(`Warning: ${warning}`));
  if (comparison.proposal !== null) {
    lines.push(`Proposal: ${comparison.proposal.what}`);
    lines.push('Probes never apply anything: the change of the pipeline file is made by hand.');
  }
  if (view.proposalPath !== null) lines.push(style.muted(`Written to ${view.proposalPath}`));
  return lines.join('\n');
}
