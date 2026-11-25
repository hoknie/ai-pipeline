import type { ProbeExperiment, ProbeProposal, ProbeScore, ProbeVersus } from './experiment.ts';

export interface ProposalInput {
  experiment: ProbeExperiment;
  scores: ProbeScore[];
  versus: ProbeVersus[];
  winner: string | null;
  overBudget: boolean;
}

function percent(score: ProbeScore): string {
  return `${Math.round(score.cleanRate * 100)}%`;
}

function signalLine(score: ProbeScore): string {
  const comparable = score.finished - score.errors;
  return `\`${score.candidate}\`: clean ${score.clean}/${comparable} (${percent(score)}), conflicts ${score.conflicts}, denials ${score.denials}, outside changes ${score.outsideChanges}, tokens ${score.tokens}`;
}

function versusLine(entry: ProbeVersus): string {
  return `\`${entry.candidate}\` vs \`${entry.baseline}\`: ${entry.wins} wins, ${entry.losses} losses, ${entry.ties} ties, p=${entry.pValue.toFixed(3)}${entry.significant ? '' : ' (not significant)'}`;
}

function whatOf(input: ProposalInput): string {
  const baseline = input.experiment.candidates[0] as string;
  if (input.overBudget) return 'no change: the experiment ran over its token budget';
  if (input.winner === null) return 'no change: the difference is not significant';
  if (input.winner === baseline) return `keep the harness of variant \`${baseline}\``;
  return `use variant \`${input.winner}\` instead of \`${baseline}\``;
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
    chosen === undefined ? 'no candidate produced a finished probe' : signalLine(chosen),
    ...scores
      .filter((score) => score.candidate !== chosen?.candidate)
      .map((score) => `${score.candidate === baseline ? 'baseline ' : ''}${signalLine(score)}`),
    ...versus.map(versusLine),
    `budget: ${experiment.runs.length}/${experiment.planned} planned run(s) created of the limit ${experiment.budget.maxRuns}, ${scores.reduce((total, score) => total + score.tokens, 0)} tokens${
      experiment.budget.maxTokens === null ? '' : ` of ${experiment.budget.maxTokens}`
    }${experiment.stopped === 'tokens' ? ', creation stopped at the token limit' : ''}`,
    'probes never apply anything: the winner is a proposal, the change of the pipeline file is made by hand',
  ];
  const lines = [
    `# Probe ${experiment.id}`,
    '',
    `Task of run ${experiment.sourceRun} (group \`${experiment.sourceGroup}\`) on base \`${experiment.baseCommit}\`.`,
    `Candidates: ${experiment.candidates.map((candidate) => `\`${candidate}\``).join(', ')}; baseline: \`${baseline}\`.`,
    '',
    `## ${whatOf(input)}`,
    '',
    ...why.map((line) => `- ${line}`),
    '',
  ];
  return { winner, what: whatOf(input), why, markdown: lines.join('\n') };
}
