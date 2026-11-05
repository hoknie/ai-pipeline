import { buildPrompt, findSpecialist } from '../config/index.ts';

import {
  isSplitGroup,
  runWorkflow,
  stepsOf,
  type Group,
  type Pending,
  type PreviousStep,
  type Run,
  type StepInput,
} from './model.ts';

export function buildInput(run: Run, group: Group, pending: Pending): StepInput {
  const step = stepsOf(run, group)[pending.stepIndex];
  if (!step) throw new Error(`step ${pending.stepIndex} does not exist`);
  const specialist = findSpecialist(run.config, step.specialist);
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
  };
}

function splitInstruction(run: Run, group: Group): string {
  if (!isSplitGroup(group)) return '';
  const maxGroups = runWorkflow(run).split?.maxGroups ?? 1;
  return `\n\nSplit this task into independent groups of work that can be done in parallel without touching the same files where possible. Call the tool \`swarm_split\` with 1 to ${maxGroups} groups, each with a short title and a self-contained task, then call \`swarm_report\` with verdict "done".`;
}
