import type { RunCreated } from '../create.ts';
import { runId } from '../create.ts';
import type { RunAttachment, RunState } from '../run.ts';

/**
 * What a contrast experiment may spend. `maxRuns` is the hard stop: a plan above it is refused and
 * no more runs are created. `maxTokens` is checked before every repetition and stops the creation
 * of further probes; the runs already created are not cancelled.
 */
export interface ProbeBudget {
  /** The most runs the experiment may create; a plan above it is refused. */
  maxRuns: number;
  /** The most tokens the created runs may use; above it no further probe is created. */
  maxTokens: number | null;
}

/** One run of an experiment: the candidate it probes and the repetition it stands for. */
export interface ProbeRun {
  runId: string;
  candidate: string;
  repetition: number;
}

/** Why the experiment has fewer runs than its plan: the token budget, or a probe that did not start. */
export type ProbeStop = 'tokens' | 'creation_failed';

/** A candidate is a pipeline variant: the harness overlay the pipeline describes. */
export interface ProbeExperiment {
  id: string;
  repository: string;
  /** The run whose task and base commit the probes repeat. */
  sourceRun: string;
  /** The group of the source run whose task is probed. */
  sourceGroup: string;
  /** The title of that group: the probes use it too, so their input is the input of the source. */
  groupTitle: string;
  /** The probed group is the split step: the probes split the task again, as the source did. */
  split: boolean;
  pipeline: string;
  task: string;
  /** The commit every probe starts from: one input, several outputs. */
  baseCommit: string;
  /** The provider of the source run: the probes keep the configuration, not only the harness. */
  provider: string | null;
  /** Steps the source run skipped; the probes skip them too. */
  skip: string[];
  /** Variant ids in the order of the experiment; the first one is the baseline. */
  candidates: string[];
  /** Runs per candidate. */
  repetitions: number;
  budget: ProbeBudget;
  /** Runs the plan asked for; `runs` is shorter when the experiment stopped early. */
  planned: number;
  /** Why the creation of runs stopped early; null when every planned run was created. */
  stopped: ProbeStop | null;
  /** The error of the launcher that stopped the experiment; null when none did. */
  stopReason: string | null;
  runs: ProbeRun[];
  createdAt: number;
  /** The proposal file of a finished experiment; null before it is written. */
  proposalPath: string | null;
}

/** A run of an experiment a candidate and a repetition stand for. */
export interface ProbeRunSpec {
  candidate: string;
  repetition: number;
}

/** The request of the probe runner: a run of the same task and base with one variant of the harness. */
export interface ProbeRunRequest {
  repository: string;
  pipeline: string;
  /** The title of the probed group; it goes into the step input of the agents. */
  groupTitle: string;
  /** The probe repeats the split step of the source: the task is split again. */
  split: boolean;
  task: string;
  baseCommit: string;
  variant: string;
  /** The provider of the source run: the only change between the probes is the harness. */
  provider: string | null;
  /** Steps the source run skipped. */
  skip: string[];
  /** Files attached to the task of the source run. */
  attachments: RunAttachment[];
  /** The task number of the source run: probes belong to that task. */
  number: number;
  /** The title of the probe run itself; the group title stays the title of the source group. */
  title: string;
}

/** Creates a probe run; the runs feature implements it. */
export interface ProbeLauncher {
  createProbe(request: ProbeRunRequest): Promise<RunCreated>;
}

/** The runs an experiment reads; the states of the runs feature implement it. */
export interface ProbeStates {
  lookup(id: string): RunState | undefined;
}

/** Whether the merged result of a run would apply cleanly on its base; conflicts name the files. */
export interface ProbeCheckResult {
  applied: boolean;
  conflicts: string[];
}

export type ProbeCheck = (state: RunState) => Promise<ProbeCheckResult>;

/** Where the experiments and their proposals live. */
export interface ProbeStore {
  save(experiment: ProbeExperiment): void;
  load(id: string): ProbeExperiment | null;
  /** Every stored experiment; the runner resumes the unfinished ones after a restart. */
  list(): ProbeExperiment[];
  /** Writes the proposal of a finished experiment and returns its path. */
  writeProposal(id: string, markdown: string): string;
}

/** The queue every change of a run goes through: it also decides when the probes advance. */
export interface ProbeQueue {
  serial<T>(work: () => Promise<T>): Promise<T>;
  /** The daemon is stopping: nothing new starts. */
  readonly stopping: boolean;
}

/** The request that starts an experiment. */
export interface ProbeStartRequest {
  runId: string;
  group?: string | null | undefined;
  candidates: string[];
  repetitions: number;
  maxRuns: number;
  maxTokens?: number | null | undefined;
}

/** What the probes of a run do with one candidate: the objective signal and the cost. */
export interface ProbeObservation {
  candidate: string;
  repetition: number;
  runId: string;
  finished: boolean;
  groups: number;
  merged: number;
  /** Files of the merged result that conflict on the base; 0 when it applies cleanly. */
  conflicts: number;
  /** Every group merged and the result applies cleanly on the base: the only full success. */
  clean: boolean;
  denials: number;
  outsideChanges: number;
  verdicts: { done: number; rejected: number; needs_human: number };
  tokens: number;
  /** Why the isolated check of the result could not run; null when it did. */
  error: string | null;
}

/** The signal of one candidate over its runs. */
export interface ProbeScore {
  candidate: string;
  runs: number;
  finished: number;
  /** Finished probes whose delivery check failed: not part of the pairs or of `cleanRate`. */
  errors: number;
  clean: number;
  groups: number;
  merged: number;
  conflicts: number;
  denials: number;
  outsideChanges: number;
  verdicts: { done: number; rejected: number; needs_human: number };
  tokens: number;
  /** Share of finished probes with a working check that came out clean; 0 when none did. */
  cleanRate: number;
}

/** How one candidate compares with the baseline over the paired repetitions. */
export interface ProbeVersus {
  candidate: string;
  baseline: string;
  pairs: number;
  wins: number;
  losses: number;
  ties: number;
  /** Two-sided exact sign test on the pairs a clean and an unclean probe decided. */
  pValue: number;
  /** Enough decided pairs and p below the level: only then the difference is a signal. */
  significant: boolean;
}

export type ProbeStatus = 'running' | 'ready' | 'budget_exhausted' | 'failed';

/** The id of an experiment: a run id with a `pr` prefix, free of the ids of runs. */
export function probeId(now: number, random: number): string {
  return `pr${runId(now, random)}`;
}

/** What changes if the winner is taken: the only form a probe ever reaches a person. */
export interface ProbeProposal {
  /** Candidate to use; the baseline id means the harness stays as it is. */
  winner: string | null;
  what: string;
  why: string[];
  markdown: string;
}

/** The comparison of the probes of one experiment. */
export interface ProbeComparison {
  status: ProbeStatus;
  observations: ProbeObservation[];
  scores: ProbeScore[];
  versus: ProbeVersus[];
  winner: string | null;
  reason: string;
  spent: { runs: number; tokens: number };
  proposal: ProbeProposal | null;
}

/** What a client gets for an experiment. */
export interface ProbeView {
  experiment: ProbeExperiment;
  status: ProbeStatus;
  comparison: ProbeComparison;
  proposalPath: string | null;
  /** What the request could not promise, e.g. too few repetitions for a significant winner. */
  warnings: string[];
}
