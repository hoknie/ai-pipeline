import type { PreviousStep, StepInput } from '../../agents/types/index.ts';
import { buildPrompt } from '../../swarm-config/types/index.ts';
import { type Group, type Pending, isSplitGroup, stepsOf } from './group.ts';
import { type Run, runPipeline, specialistOfStep } from './run.ts';

export function buildInput(run: Run, group: Group, pending: Pending): StepInput {
  const step = stepsOf(run, group)[pending.stepIndex];
  if (!step) throw new Error(`step ${pending.stepIndex} does not exist`);
  const specialist = specialistOfStep(run, group, step);
  if (!specialist) throw new Error(`specialist ${step.specialist} does not exist`);
  const previous: PreviousStep[] = group.attempts.flatMap((attempt) =>
    attempt.status === 'finished' && attempt.report
      ? [
          {
            stepId: attempt.stepId,
            specialist: attempt.specialist,
            verdict: attempt.report.verdict,
            summary: attempt.report.summary,
          },
        ]
      : [],
  );
  return {
    prompt:
      buildPrompt(specialist.prompt, group.task, step.additionalPrompt ?? null) +
      splitInstruction(run, group),
    groupTitle: group.title,
    stepId: step.id,
    specialistName: specialist.name,
    skills: [...specialist.skills],
    previous,
    feedback: pending.feedback,
    humanAnswer: pending.humanAnswer,
    ...(pending.message ? { message: { ...pending.message } } : {}),
    decisions: group.decisions.map((decision) => ({ ...decision })),
    ...(step.humanReview ? { humanReview: true } : {}),
    ...(pending.reviewed ? { reviewed: true } : {}),
    ...(run.attachments.length > 0
      ? {
          attachments: run.attachments.map(({ fileName, size, mediaType }) => ({
            fileName,
            size,
            mediaType,
          })),
        }
      : {}),
  };
}

function splitInstruction(run: Run, group: Group): string {
  if (!isSplitGroup(group)) return '';
  return `\n\n${splitInstructionText(runPipeline(run).split?.maxGroups ?? 1)}`;
}

/** The instruction the split step adds to the prompt of its specialist. */
export function splitInstructionText(maxGroups: number | string): string {
  return `Split this task into independent groups of work that can be done in parallel without touching the same files where possible. Call the tool \`swarm_split\` with 1 to ${maxGroups} groups, each with a short title and a self-contained task, then call \`swarm_report\` with verdict "done".`;
}

/** The fixed part of the task of the commit message author; the run adds its own sections. */
export const MESSAGE_INSTRUCTIONS = (run: string): string[] => [
  `Write a git commit message for the changes of run ${run}. The first line is a short subject; then a blank line and a body.`,
  `Report the full message as the summary of swarm_report with verdict "done". Do not change any files.`,
];

/** The fixed part of the task of the resolver; the run adds its own sections. */
export const RESOLVE_INSTRUCTIONS = (run: string): string[] => [
  `Your working directory holds the user's current working tree with the changes of run ${run} applied on top. The files below contain git conflict markers (<<<<<<<, =======, >>>>>>>) where the changes of the run and the user's own edits collide.`,
  'Resolve every conflict so that both the edits of the user and the intent of the run are kept. Remove every conflict marker, run the checks of the project if you can, and report done. Report rejected if the conflicts cannot be resolved safely.',
  'Run the checks in the foreground and wait for their result in the same shell command, with a timeout long enough for the whole check (up to 10 minutes). Never start them in the background and never wait for them with `pgrep`, `pkill` or `sleep` loops: the name of the check command also appears in the command lines of other agents and of your own shell, so such a wait never ends.',
];

/** A run named in a task: by id (with a group from a panel link) or by its task number. */
export type RunReference =
  { kind: 'id'; id: string; group: string | null } | { kind: 'number'; number: number };

const RUN_ID = /^[a-z0-9]+$/;
const PANEL_LINK = /#runs\/([^/?#\s]+)(?:\/([^/?#\s]+))?/;

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/**
 * Reads a run reference: a panel link with `#runs/<run>[/<group>…]` (host and port do not matter),
 * a task number `333` or `#333`, or a run id. Anything else gives null.
 */
export function parseRunReference(text: string): RunReference | null {
  const value = text.trim();
  const link = PANEL_LINK.exec(value);
  if (link) {
    const id = decode(link[1] ?? '');
    if (id === null || !RUN_ID.test(id)) return null;
    const group = link[2] === undefined ? null : decode(link[2]);
    if (link[2] !== undefined && (group === null || group === '')) return null;
    return { kind: 'id', id, group };
  }
  const number = /^#?(\d+)$/.exec(value);
  if (number) return { kind: 'number', number: Number(number[1]) };
  if (RUN_ID.test(value)) return { kind: 'id', id: value, group: null };
  return null;
}
