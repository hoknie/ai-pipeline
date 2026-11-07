import type { Specialist } from '../feature/swarm-config/types/index.ts';
import type { StepInput } from '../core/index.ts';

import { describePermissions } from './types.ts';

export function systemPrompt(specialist: Specialist, input: StepInput): string {
  const lines = [
    `You are "${specialist.name}", a specialist in an aip swarm. Group: "${input.groupTitle}". Step: "${input.stepId}".`,
    'You work in an isolated git worktree: the current directory. Change files only inside it. Never run git push, git checkout or git switch, and never touch other directories.',
    describePermissions(specialist.permissions),
    'If a tool call is refused for lack of permission, look for another way to do it within your permissions. Report "needs_human" only when the step cannot be done without the refused action, and name the refused command in the question.',
    'When you are finished you MUST call the tool `swarm_report` exactly as the last action:',
    '- verdict "done" when the step is complete;',
    '- verdict "rejected" when the work you received must be redone; put concrete remarks into feedback;',
    '- verdict "needs_human" when you cannot continue without a decision from a person; put the question into feedback. When you have several independent questions, ask them all in one report through `questions` (each with a `recommendation`, and `options` when the answer is a clear choice) instead of feedback. Add `human_only: true` when only a person may answer, for example when you ask them to look personally at what you wrote.',
    'Always pass a short summary of what you did. Without swarm_report the step counts as failed.',
  ];
  if (specialist.skills.length > 0) {
    lines.push(`Use these skills for this step: ${specialist.skills.join(', ')}.`);
  }
  if (input.humanReview) {
    lines.push(
      'After you report "done" a person reviews this step before the work goes on. In the summary list what to check: architecture decisions, risky places, assumptions you made.',
    );
  }
  return lines.join('\n');
}

export function userMessage(input: StepInput): string {
  const sections = [input.prompt];
  if (input.previous.length > 0) {
    sections.push(
      [
        '## Previous steps',
        ...input.previous.map(
          (previous) =>
            `- ${previous.stepId} (${previous.specialist}, ${previous.verdict}): ${previous.summary}`,
        ),
      ].join('\n'),
    );
  }
  if (input.decisions.length > 0) {
    sections.push(
      [
        '## Accepted answers to questions in this group (do not ask them again)',
        ...input.decisions.map(
          (decision) =>
            `- ${decision.stepId}: Q: ${decision.question} A: ${decision.answer} (by ${decision.by})`,
        ),
      ].join('\n'),
    );
  }
  if (input.feedback) sections.push(`## Feedback to address\n${input.feedback}`);
  if (input.humanAnswer) {
    sections.push(
      input.reviewed
        ? `## Answer of the person who reviewed this step\n${input.humanAnswer}\n\nAddress the remarks, and report "done" at once if there is nothing to change.`
        : `## Latest accepted answer\n${input.humanAnswer}`,
    );
  }
  if (input.message) {
    sections.push(
      `## Message from the person (sent ${new Date(input.message.at).toISOString()})\n${input.message.text}`,
    );
  }
  return sections.join('\n\n');
}
