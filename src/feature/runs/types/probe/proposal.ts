import type { ProbeExperiment, ProbeProposal, ProbeScore, ProbeVersus } from './experiment.ts';
import type { ProbeObservation } from './experiment.ts';
import { pairReport } from './pair-report.ts';

export interface ProposalInput {
  experiment: ProbeExperiment;
  scores: ProbeScore[];
  versus: ProbeVersus[];
  winner: string | null;
  overBudget: boolean;
  observations: ProbeObservation[];
}

function safe(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

function percent(score: ProbeScore): string {
  return `${Math.round(score.cleanRate * 100)}%`;
}

function measuredTokens(observations: ProbeObservation[]): number | null {
  if (observations.length === 0) return null;
  let total = 0;
  for (const observation of observations) {
    const summary = observation.summary;
    if (!observation.finished || summary?.inputTokens == null || summary.outputTokens == null)
      return null;
    total += summary.inputTokens + summary.outputTokens;
  }
  return total;
}

function signalLine(score: ProbeScore, observations: ProbeObservation[]): string {
  const comparable = score.finished - score.errors;
  const tokens = measuredTokens(
    observations.filter((entry) => entry.candidate === score.candidate),
  );
  const cleanRate = comparable === 0 ? 'unknown' : percent(score);
  return `\`${safe(score.candidate)}\`: clean ${score.clean}/${comparable} (${cleanRate}; checked probes only), conflicts ${score.conflicts ?? 'unknown'}, denials ${score.denials}, outside changes ${score.outsideChanges}, tokens ${tokens ?? 'unknown'}`;
}

function versusLine(entry: ProbeVersus): string {
  return `\`${safe(entry.candidate)}\` vs \`${safe(entry.baseline)}\`: ${entry.wins} wins, ${entry.losses} losses, ${entry.ties} ties, p=${entry.pValue.toFixed(3)}${entry.significant ? '' : ' (not significant)'}`;
}

function whatOf(input: ProposalInput): string {
  const baseline = input.experiment.candidates[0] as string;
  if (input.overBudget) return 'no change: the experiment ran over its token budget';
  if (input.winner === null) return 'no change: the difference is not significant';
  if (input.winner === baseline) return `keep the harness of variant \`${safe(baseline)}\``;
  if (!pairReport(input.experiment, input.observations, input.winner).safe) {
    return 'no change: pair evidence is insufficient or disagrees with the statistical winner';
  }
  return `use variant \`${safe(input.winner)}\` instead of \`${safe(baseline)}\``;
}

/**
 * The only form a probe reaches a person: what would change and which objective signal says it is
 * better. There is no automatic application: the variant is written into the pipeline file by hand.
 */
export function proposalOf(input: ProposalInput): ProbeProposal {
  const { experiment, scores, versus, winner } = input;
  const baseline = experiment.candidates[0] as string;
  const chosen = scores.find((score) => score.candidate === (winner ?? baseline));
  const why = [
    chosen === undefined
      ? 'no candidate produced a finished probe'
      : signalLine(chosen, input.observations),
    ...scores
      .filter((score) => score.candidate !== chosen?.candidate)
      .map(
        (score) =>
          `${score.candidate === baseline ? 'baseline ' : ''}${signalLine(score, input.observations)}`,
      ),
    ...versus.map(versusLine),
    `budget: ${experiment.runs.length}/${experiment.planned} planned run(s) created of the limit ${experiment.budget.maxRuns}, ${measuredTokens(input.observations) === null ? 'measured tokens unknown' : `${measuredTokens(input.observations)} tokens`}${
      experiment.budget.maxTokens === null ? '' : ` of ${experiment.budget.maxTokens}`
    }${experiment.stopped === 'tokens' ? ', creation stopped at the token limit' : ''}`,
    'probes never apply anything: the winner is a proposal, the change of the pipeline file is made by hand',
  ];
  const lines = [
    `# Probe ${safe(experiment.id)}`,
    '',
    `Task of run ${safe(experiment.sourceRun)} (group \`${safe(experiment.sourceGroup)}\`) on base \`${safe(experiment.baseCommit)}\`.`,
    `Candidates: ${experiment.candidates.map((candidate) => `\`${safe(candidate)}\``).join(', ')}; baseline: \`${safe(baseline)}\`.`,
    '',
    `## ${whatOf(input)}`,
    '',
    ...why.map((line) => `- ${line}`),
    '',
    '## Descriptive pair evidence (separate from the sign test)',
    '',
    pairReport(experiment, input.observations, winner).markdown,
  ];
  return { winner, what: whatOf(input), why, markdown: lines.join('\n') };
}
