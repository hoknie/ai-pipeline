import type { ProbeComparison, ProbeExperiment, ProbeStore } from '../../types/index.ts';

/** Store one completed experiment's proposal, including inconclusive pairs, only once. */
export function keepProposal(
  store: ProbeStore,
  experiment: ProbeExperiment,
  comparison: ProbeComparison,
): ProbeExperiment {
  const [baseline, ...candidates] = experiment.candidates;
  const hasPair = comparison.observations.some(
    (base) =>
      base.finished &&
      base.candidate === baseline &&
      comparison.observations.some(
        (other) =>
          other.finished &&
          candidates.includes(other.candidate) &&
          other.repetition === base.repetition,
      ),
  );
  if (
    !hasPair ||
    comparison.observations.length !== experiment.runs.length ||
    comparison.observations.some((observation) => !observation.finished) ||
    comparison.status === 'running' ||
    comparison.status === 'failed' ||
    comparison.proposal === null ||
    experiment.proposalPath !== null
  )
    return experiment;
  // The check above may have awaited while another view published the same experiment. Store
  // operations here are synchronous: reload and publish without yielding between them.
  const current = store.load(experiment.id);
  if (current === null || current.proposalPath !== null) return current ?? experiment;
  if (
    current.planned !== experiment.planned ||
    current.stopped !== experiment.stopped ||
    current.stopReason !== experiment.stopReason ||
    JSON.stringify(current.runs) !== JSON.stringify(experiment.runs) ||
    (current.stopped === null && current.runs.length < current.planned)
  )
    return current;
  const saved = {
    ...current,
    proposalPath: store.writeProposal(experiment.id, comparison.proposal.markdown),
  };
  store.save(saved);
  return saved;
}
