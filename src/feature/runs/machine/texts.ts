import {
  type Group,
  type HumanQuestion,
  type RunState,
  MESSAGE_INSTRUCTIONS,
  RESOLVE_INSTRUCTIONS,
} from '../types/index.ts';

/** Text version of structured questions: a numbered list with options and a recommendation. */
export function questionsText(questions: readonly HumanQuestion[]): string {
  return questions
    .map((question, index) => {
      const lines = [`${index + 1}. ${question.text.trim()}`];
      const options = question.options ?? [];
      if (options.length > 0) lines.push(`   Options: ${options.join(' | ')}`);
      if (question.recommendation) lines.push(`   Recommended: ${question.recommendation}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** The question of a human review: the finished step and what its specialist reported. */
export function reviewQuestion(stepLabel: string, summary: string): string {
  return `Step \`${stepLabel}\` is done and waits for your review. Summary:\n${summary.trim()}\n\nAnswer to accept, or describe what to change.`;
}

export function lastSummary(group: Group): string {
  const finished = group.attempts.filter(
    (attempt) => attempt.status === 'finished' && attempt.report,
  );
  return finished.at(-1)?.report?.summary.split('\n')[0]?.trim() ?? '';
}

function title(state: RunState, groups: Group[]): string {
  if (groups.length === 1 && groups[0]) return groups[0].title;
  const task = state.split?.task.split('\n')[0]?.trim();
  if (task) return task.slice(0, 72);
  return `${groups.length} groups: ${groups.map((group) => group.title).join(', ')}`.slice(0, 72);
}

export function task(state: RunState, groups: Group[]): string {
  if (state.split) return state.split.task;
  return groups.map((group) => group.task).join('\n\n');
}

export function renderCommitMessage(template: string, state: RunState, groups: Group[]): string {
  const values: Record<string, string> = {
    title: title(state, groups),
    task: task(state, groups),
    run: state.run.id,
    pipeline: state.run.pipeline,
    // The old name of `{pipeline}`, kept for templates written before the rename.
    workflow: state.run.pipeline,
    groups: groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n'),
  };
  const text = template.replace(
    /\{(title|task|run|pipeline|workflow|groups)\}/g,
    (_, key: string) => values[key] ?? '',
  );
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function withPrompt(parts: string[], prompt: string | undefined): string {
  return (prompt ? [...parts, prompt] : parts).join('\n\n');
}

export function messageTask(state: RunState, groups: Group[], files: string[]): string {
  return withPrompt(
    [
      ...MESSAGE_INSTRUCTIONS(state.run.id),
      `Task:\n${task(state, groups)}`,
      `Groups:\n${groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n')}`,
      `Changed files:\n${files.map((file) => `- ${file}`).join('\n') || '- (none)'}`,
    ],
    state.run.config.delivery.messagePrompt,
  );
}

export function resolveTask(state: RunState, groups: Group[], conflicts: string[]): string {
  return withPrompt(
    [
      ...RESOLVE_INSTRUCTIONS(state.run.id),
      `Conflicting files:\n${conflicts.map((file) => `- ${file}`).join('\n')}`,
      `Task of the run:\n${task(state, groups)}`,
      `Groups:\n${groups.map((group) => `- ${group.title}: ${lastSummary(group)}`).join('\n')}`,
    ],
    state.run.config.delivery.resolverPrompt,
  );
}
