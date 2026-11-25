import { formatProbe } from '../../../format/index.ts';
import { MIN_DECIDING_PAIRS, type ProbeView } from '../../../ipc/contract/index.ts';
import { call } from '../../context.ts';
import { usage } from '../../io.ts';
import { collect } from '../../options.ts';
import type { RunKit } from '../run.ts';

interface ProbeOptions {
  group?: string;
  candidate?: string[];
  repetitions?: string;
  maxRuns?: string;
  maxTokens?: string;
  json?: boolean;
}

function positive(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw usage(`${name} must be a positive integer`);
  return parsed;
}

/** The fields of `run_contrast`: the candidates and an explicit budget. */
function probeParams(runId: string, options: ProbeOptions) {
  const candidates = options.candidate ?? [];
  if (candidates.length < 2) {
    throw usage('a contrast needs at least two --candidate variants: the baseline and one more');
  }
  const repetitions = positive(options.repetitions, '--repetitions', MIN_DECIDING_PAIRS);
  if (repetitions < MIN_DECIDING_PAIRS) {
    throw usage(
      `--repetitions must be at least ${MIN_DECIDING_PAIRS}: fewer paired runs cannot prove a win`,
    );
  }
  const maxRuns = positive(options.maxRuns, '--max-runs', candidates.length * repetitions);
  const maxTokens =
    options.maxTokens === undefined ? undefined : positive(options.maxTokens, '--max-tokens', 1);
  return {
    runId,
    ...(options.group === undefined ? {} : { group: options.group }),
    candidates,
    repetitions,
    maxRuns,
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

export function addContrast(kit: RunKit): void {
  const { output, examples, context, activeStyle, run } = kit;
  run
    .command('contrast')
    .description(
      'Run the task of a run again on the same base with several variants; compares them by the objective signal and proposes a winner without applying it',
    )
    .argument('<run-id>', 'run id whose task and base commit are probed')
    .option('--group <slug>', 'work group of the run; defaults to its first group')
    .option(
      '--candidate <variant>',
      'pipeline variant; repeat for several, the first is the baseline',
      collect,
    )
    .option(
      '--repetitions <n>',
      `runs per candidate; at least ${MIN_DECIDING_PAIRS} decided pairs are needed for a winner`,
      String(MIN_DECIDING_PAIRS),
    )
    .option('--max-runs <n>', 'hard limit of runs; defaults to candidates × repetitions')
    .option(
      '--max-tokens <n>',
      'soft limit of tokens; reached before the next repetition, no further probe is created',
    )
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip run contrast 0mh3k2ab1x9z --candidate default --candidate strong --max-runs 12',
      ]),
    )
    .action(async (runId: string, options: ProbeOptions) => {
      const view = (await call(
        context(),
        'run_contrast',
        probeParams(runId, options),
      )) as ProbeView;
      output(options.json, formatProbe(view, activeStyle), view);
    });
}

export function addContrastShow(kit: RunKit): void {
  const { output, examples, context, activeStyle, run } = kit;
  run
    .command('contrast-show')
    .description('Show the signals, the comparison and the proposal of a probe experiment')
    .argument('<probe-id>', 'id of the experiment, e.g. pr0mh3k2ab1x9z')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip run contrast-show pr0mh3k2ab1x9z']))
    .action(async (id: string, options: { json?: boolean }) => {
      const view = (await call(context(), 'contrast_show', { id })) as ProbeView;
      output(options.json, formatProbe(view, activeStyle), view);
    });
}
