import type {
  ProbeComparison,
  ProbeExperiment,
  ProbeObservation,
  ProbeScore,
  ProbeVersus,
} from './experiment.ts';
import { proposalOf } from './proposal.ts';
import { isSignificant, signTestP } from './statistics.ts';

function emptyScore(candidate: string): ProbeScore {
  return {
    candidate,
    runs: 0,
    finished: 0,
    errors: 0,
    clean: 0,
    groups: 0,
    merged: 0,
    conflicts: 0,
    denials: 0,
    outsideChanges: 0,
    verdicts: { done: 0, rejected: 0, needs_human: 0 },
    tokens: 0,
    cleanRate: 0,
  };
}

/** The signal of one candidate over every probe run of it. */
export function scoreOf(candidate: string, observations: ProbeObservation[]): ProbeScore {
  const own = observations.filter((observation) => observation.candidate === candidate);
  const score = own.reduce((total, observation) => {
    total.runs += 1;
    if (observation.finished) total.finished += 1;
    if (observation.finished && observation.error !== null) total.errors += 1;
    if (observation.clean) total.clean += 1;
    total.groups += observation.groups;
    total.merged += observation.merged;
    total.conflicts =
      total.conflicts === null || observation.conflicts === null || observation.error !== null
        ? null
        : total.conflicts + observation.conflicts;
    total.denials += observation.denials;
    total.outsideChanges += observation.outsideChanges;
    total.verdicts.done += observation.verdicts.done;
    total.verdicts.rejected += observation.verdicts.rejected;
    total.verdicts.needs_human += observation.verdicts.needs_human;
    total.tokens += observation.tokens;
    return total;
  }, emptyScore(candidate));
  if (own.length === 0) score.conflicts = null;
  const comparable = score.finished - score.errors;
  score.cleanRate = comparable === 0 ? 0 : score.clean / comparable;
  return score;
}

/** One clean probe beaten by an unclean one, or the other way; a tie when both agree. */
function pairOutcome(
  candidate: ProbeObservation | undefined,
  baseline: ProbeObservation | undefined,
): 'win' | 'loss' | 'tie' | null {
  if (candidate === undefined || baseline === undefined) return null;
  if (!candidate.finished || !baseline.finished) return null;
  // A probe whose delivery check failed says nothing about the harness: it decides no pair.
  if (candidate.error !== null || baseline.error !== null) return null;
  if (candidate.clean === baseline.clean) return 'tie';
  return candidate.clean ? 'win' : 'loss';
}

/** Compares a candidate with the baseline repetition by repetition: one bit per pair. */
export function versusOf(
  candidate: string,
  baseline: string,
  observations: ProbeObservation[],
  repetitions: number,
): ProbeVersus {
  let pairs = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const own = observations.find(
      (observation) => observation.candidate === candidate && observation.repetition === repetition,
    );
    const base = observations.find(
      (observation) => observation.candidate === baseline && observation.repetition === repetition,
    );
    const outcome = pairOutcome(own, base);
    if (outcome === null) continue;
    pairs += 1;
    if (outcome === 'win') wins += 1;
    else if (outcome === 'loss') losses += 1;
    else ties += 1;
  }
  return {
    candidate,
    baseline,
    pairs,
    wins,
    losses,
    ties,
    pValue: signTestP(wins, losses),
    significant: isSignificant(wins, losses),
  };
}

function bestOf(candidates: string[], scores: ProbeScore[], versus: ProbeVersus[]): string {
  return candidates.reduce((best, candidate) => {
    const current = scores.find((score) => score.candidate === candidate);
    const leader = scores.find((score) => score.candidate === best);
    const ownWins = versus.find((entry) => entry.candidate === candidate)?.wins ?? 0;
    const leaderWins = versus.find((entry) => entry.candidate === best)?.wins ?? 0;
    if ((current?.cleanRate ?? 0) !== (leader?.cleanRate ?? 0)) {
      return (current?.cleanRate ?? 0) > (leader?.cleanRate ?? 0) ? candidate : best;
    }
    return ownWins > leaderWins ? candidate : best;
  }, candidates[0] as string);
}

function decide(
  experiment: ProbeExperiment,
  scores: ProbeScore[],
  versus: ProbeVersus[],
  errors: number,
): { winner: string | null; reason: string } {
  const baseline = experiment.candidates[0] as string;
  const unchecked =
    errors === 0
      ? ''
      : `; ${errors} probe(s) could not be checked and decided no pair${errors === 1 ? '' : 's'}`;
  const better = versus.filter((entry) => entry.significant && entry.wins > entry.losses);
  if (better.length > 0) {
    const winner = bestOf(
      better.map((entry) => entry.candidate),
      scores,
      versus,
    );
    return {
      winner,
      reason: `variant \`${winner}\` would apply cleanly more often than \`${baseline}\`${unchecked}`,
    };
  }
  const worse = versus.filter((entry) => entry.significant && entry.losses > entry.wins);
  if (versus.length > 0 && worse.length === versus.length) {
    return {
      winner: baseline,
      reason: `every candidate is significantly worse than the baseline \`${baseline}\`${unchecked}`,
    };
  }
  return {
    winner: null,
    reason:
      versus.length === 0
        ? 'there is no candidate to compare with the baseline'
        : `no significant difference: ${versus
            .map((entry) => `\`${entry.candidate}\` p=${entry.pValue.toFixed(3)}`)
            .join(', ')}${unchecked}; the budget allows at most ${experiment.budget.maxRuns} runs`,
  };
}

/**
 * Compares the probes by the objective signal only: a clean check on the same base weighs more
 * than any verdict, and a difference counts only when the exact sign test trusts it. A probe whose
 * check failed decides no pair; a budget that ran out makes the experiment inconclusive instead of
 * quietly widening it.
 */
export function compareExperiment(
  experiment: ProbeExperiment,
  observations: ProbeObservation[],
): ProbeComparison {
  const scores = experiment.candidates.map((candidate) => scoreOf(candidate, observations));
  const baseline = experiment.candidates[0] as string;
  const versus = experiment.candidates
    .slice(1)
    .map((candidate) => versusOf(candidate, baseline, observations, experiment.repetitions));
  const tokens = scores.reduce((total, score) => total + score.tokens, 0);
  const spent = { runs: observations.length, tokens };
  const errors = observations.filter(
    (observation) => observation.finished && observation.error !== null,
  ).length;
  const overBudget = experiment.budget.maxTokens !== null && tokens > experiment.budget.maxTokens;
  const stoppedByTokens = experiment.stopped === 'tokens';
  const running =
    experiment.stopped === null &&
    !overBudget &&
    observations.some((observation) => !observation.finished);
  const status: ProbeComparison['status'] =
    experiment.stopped === 'creation_failed'
      ? 'failed'
      : stoppedByTokens || overBudget
        ? 'budget_exhausted'
        : running
          ? 'running'
          : 'ready';
  if (status === 'running') {
    return {
      status,
      observations,
      scores,
      versus,
      winner: null,
      reason: 'the probes are still running',
      spent,
      proposal: null,
    };
  }
  if (status === 'failed') {
    const why = experiment.stopReason
      ? `a probe did not start: ${experiment.stopReason}`
      : 'a probe did not start';
    return {
      status,
      observations,
      scores,
      versus,
      winner: null,
      reason: `the experiment stopped after ${observations.length} of ${experiment.planned} run(s): ${why}`,
      spent,
      proposal: null,
    };
  }
  const budgetReason = stoppedByTokens
    ? `the experiment stopped creating probes after ${observations.length} of ${experiment.planned} run(s): the tokens reached the budget of ${experiment.budget.maxTokens}`
    : `the probes used ${tokens} tokens, above the budget of ${experiment.budget.maxTokens}`;
  const { winner, reason } =
    status === 'budget_exhausted'
      ? { winner: null, reason: budgetReason }
      : decide(experiment, scores, versus, errors);
  const proposal = proposalOf({
    experiment,
    scores,
    versus,
    winner,
    overBudget: status === 'budget_exhausted',
    observations,
  });
  return { status, observations, scores, versus, winner, reason, spent, proposal };
}
