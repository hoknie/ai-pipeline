import { compareHarnessProbes, formatHarnessProposal } from './harness-comparison.ts';
import type { ProbeExperiment, ProbeObservation } from './experiment.ts';

/** Pair evidence is descriptive only; it never changes the experiment's statistical winner. */
export function pairReport(
  experiment: ProbeExperiment,
  observations: ProbeObservation[],
  winner: string | null,
) {
  const [baseline, ...candidates] = experiment.candidates;
  const lines: string[] = [];
  let winnerPairs = 0;
  let winnerSafe = true;
  for (const candidate of candidates) {
    for (let repetition = 1; repetition <= experiment.repetitions; repetition += 1) {
      const base = observations.find(
        (item) => item.candidate === baseline && item.repetition === repetition,
      );
      const other = observations.find(
        (item) => item.candidate === candidate && item.repetition === repetition,
      );
      lines.push(`## Pair ${repetition}`, '');
      if (!base?.summary || !other?.summary || !base.finished || !other.finished) {
        lines.push('Insufficient pair data; no change.', '');
        if (candidate === winner) winnerSafe = false;
        continue;
      }
      const comparison = compareHarnessProbes(base.summary, other.summary);
      lines.push(formatHarnessProposal(comparison), '');
      if (candidate === winner) {
        winnerPairs += 1;
        if (comparison.recommendation !== 'candidate') winnerSafe = false;
      }
    }
  }
  return { markdown: lines.join('\n'), safe: winnerPairs === experiment.repetitions && winnerSafe };
}
