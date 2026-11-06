import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  MarkdownProps,
  TextProps,
} from 'claude-code';

import type { AipActionResult, AipConnection, AipRun } from '../types';

import { draftKey } from './feed.ts';
import {
  panelView,
  type GroupLine,
  type NeedsYou,
  type OpenQuestion,
  type PanelView,
  type RunLine,
  type RunView,
} from './pane.ts';
import { ATTENTION_COLOR, STATUS } from './theme.ts';

export { RUNS_SHOWN } from './feed.ts';

export type PaneElements = {
  Box: ElementConstructor<BoxProps>;
  Text: ElementConstructor<TextProps>;
  Button: ElementConstructor<ButtonProps>;
  Markdown: ElementConstructor<MarkdownProps>;
  Input?: ElementConstructor<InputProps>;
};

export type PaneModel = {
  runs: readonly AipRun[];
  selected: string | null;
  connection: AipConnection;
  drafts: Readonly<Record<string, string>>;
  action: AipActionResult | null;
  pending: readonly string[];
  compact: boolean;
  now: number;
};

export type PaneActions = {
  select: (runId: string) => void;
  draft: (key: string, text: string) => void;
  answer: (runId: string, group: string, text?: string, question?: number) => void;
  retry: (runId: string, group: string) => void;
  cancel: (runId: string, group?: string) => void;
  apply: (runId: string, group?: string) => void;
};

export function actionKey(kind: string, runId: string, group?: string): string {
  return group ? `${kind}:${runId}/${group}` : `${kind}:${runId}`;
}

export function renderPane(elements: PaneElements, model: PaneModel, actions: PaneActions) {
  const { Box, Text, Button, Markdown, Input } = elements;
  const view = panelView(model, { compact: model.compact, now: model.now });

  return (
    <Box flexDirection="column" gap={1}>
      {header(view)}
      {note(view)}
      {resultLine(view)}
      {view.empty && (
        <Text dimColor>No runs yet. Start one with /aip:run &lt;pipeline&gt; &lt;task&gt;.</Text>
      )}
      {needsYou(view.needs)}
      {runList(view)}
      {view.run && runPanel(view.run)}
    </Box>
  );

  function busy(kind: string, runId: string, group?: string): boolean {
    return model.pending.includes(actionKey(kind, runId, group));
  }

  function header(current: PanelView) {
    const link = current.header.connection;
    return (
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text bold wrap="truncate-end">
          {current.header.summary}
        </Text>
        <Text color={link.color} wrap="truncate-end">
          {link.icon} {link.label}
        </Text>
      </Box>
    );
  }

  function note(current: PanelView) {
    if (!current.note) return null;
    return (
      <Text color={current.note.color ?? undefined} dimColor={current.note.color === null}>
        {current.note.text}
      </Text>
    );
  }

  function resultLine(current: PanelView) {
    if (!current.result) return null;
    return (
      <Text color={current.result.color}>
        {current.result.icon} {current.result.text}
      </Text>
    );
  }

  function needsYou(needs: NeedsYou) {
    if (needs.open.length === 0 && needs.rows.length === 0) return null;
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={ATTENTION_COLOR}
        paddingX={1}
        gap={1}
      >
        <Text bold color={ATTENTION_COLOR}>
          Needs you
        </Text>
        {needs.open.map(openQuestion)}
        {(needs.rows.length > 0 || needs.more > 0) && (
          <Box flexDirection="column">
            {needs.rows.map((item) => (
              <Box key={`attention-row:${item.runId}/${item.slug}`} flexDirection="row" gap={1}>
                <Text color={item.style.color}>{item.style.icon}</Text>
                <Button
                  plain
                  key={`attention:${item.runId}/${item.slug}`}
                  onPress={() => actions.select(item.runId)}
                >
                  {item.slug} · {item.runLabel} — {item.text}
                </Button>
              </Box>
            ))}
            {needs.more > 0 && <Text dimColor>+{needs.more} more</Text>}
          </Box>
        )}
      </Box>
    );
  }

  function openQuestion(item: OpenQuestion) {
    const key = `${item.runId}/${item.slug}`;
    const style = STATUS.needs_human;
    const canAnswer = Input !== undefined || item.questions !== null;
    return (
      <Box key={`open:${key}`} flexDirection="column">
        <Text color={style.color} wrap="truncate-end">
          {style.icon} {item.slug}
          {item.title !== item.slug ? ` — ${item.title}` : ''}
        </Text>
        {questionBox(item)}
        {canAnswer && (
          <Box flexDirection="row" gap={1}>
            <Button
              key={`answer:${key}`}
              variant="primary"
              onPress={() =>
                !busy('answer', item.runId, item.slug) && actions.answer(item.runId, item.slug)
              }
            >
              {busy('answer', item.runId, item.slug) ? '…' : 'answer'}
            </Button>
          </Box>
        )}
      </Box>
    );
  }

  function runList(current: PanelView) {
    if (current.runs.length === 0) return null;
    return (
      <Box flexDirection="column">
        <Text bold>Runs</Text>
        {current.runs.map(runLine)}
        {current.hiddenRuns > 0 && <Text dimColor>+{current.hiddenRuns} more</Text>}
      </Box>
    );
  }

  function runLine(row: RunLine) {
    return (
      <Box key={`run-row:${row.id}`} flexDirection="row" gap={1}>
        <Text key={`mark:${row.id}`} color={ATTENTION_COLOR} bold>
          {row.marker ?? ' '}
        </Text>
        <Text color={row.style.color} dimColor={row.isDim}>
          {row.style.icon}
        </Text>
        <Button
          plain
          key={`run:${row.id}`}
          hotkey={row.hotkey}
          dimColor={row.isDim}
          onPress={() => actions.select(row.id)}
        >
          {row.label}
          {row.bar ? ` ${row.bar}` : ''} {row.done}/{row.total}
          {row.age ? ` · ${row.age}` : ''}
          {row.cost ? ` · ${row.cost}` : ''}
        </Button>
      </Box>
    );
  }

  function runPanel(current: RunView) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold color={current.style.color} wrap="truncate-end">
            {current.style.icon} {current.label}
          </Text>
          {current.actions.length > 0 && (
            <Box flexDirection="row" gap={1}>
              {current.actions.includes('cancel') && (
                <Button
                  key={`cancel:${current.id}`}
                  onPress={() => !busy('cancel', current.id) && actions.cancel(current.id)}
                >
                  {busy('cancel', current.id) ? '…' : 'cancel run'}
                </Button>
              )}
              {current.actions.includes('apply') && (
                <Button
                  key={`apply:${current.id}`}
                  variant="primary"
                  onPress={() => !busy('apply', current.id) && actions.apply(current.id)}
                >
                  {busy('apply', current.id) ? '…' : 'apply run'}
                </Button>
              )}
            </Box>
          )}
        </Box>
        <Text dimColor wrap="truncate-end">
          {current.meta}
        </Text>
        {current.groups.map((one) => groupRow(current.id, one))}
      </Box>
    );
  }

  function groupRow(runId: string, group: GroupLine) {
    const key = `${runId}/${group.slug}`;
    return (
      <Box
        key={`group:${key}`}
        flexDirection="column"
        marginTop={model.compact ? 0 : 1}
        hover={{ backgroundColor: 'subtle' }}
      >
        <Text color={group.style.color} wrap="truncate-end">
          {group.line}
        </Text>
        {group.details !== null && (
          <Text dimColor wrap="truncate-end">
            {group.details}
          </Text>
        )}
        {group.reason && (
          <Text color={STATUS.failed.color} wrap="truncate-end">
            Reason: {group.reason}
          </Text>
        )}
        {group.actions.length > 0 && (
          <Box flexDirection="row" gap={1}>
            {group.actions.includes('retry') && (
              <Button
                key={`retry:${key}`}
                variant="primary"
                onPress={() =>
                  !busy('retry', runId, group.slug) && actions.retry(runId, group.slug)
                }
              >
                {busy('retry', runId, group.slug) ? '…' : 'retry'}
              </Button>
            )}
            {group.actions.includes('apply') && (
              <Button
                key={`apply:${key}`}
                variant="primary"
                onPress={() =>
                  !busy('apply', runId, group.slug) && actions.apply(runId, group.slug)
                }
              >
                {busy('apply', runId, group.slug) ? '…' : 'apply'}
              </Button>
            )}
            {group.actions.includes('cancel') && (
              <Button
                key={`cancel:${key}`}
                onPress={() =>
                  !busy('cancel', runId, group.slug) && actions.cancel(runId, group.slug)
                }
              >
                {busy('cancel', runId, group.slug) ? '…' : 'cancel'}
              </Button>
            )}
          </Box>
        )}
      </Box>
    );
  }

  function questionBox(item: OpenQuestion) {
    const { runId, slug } = item;
    const key = `${runId}/${slug}`;
    if (item.questions) {
      const questions = item.questions;
      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={ATTENTION_COLOR}
          paddingX={1}
          gap={1}
        >
          {questions.map((question, index) => {
            const field = draftKey(runId, slug, index);
            const value = model.drafts[field] || question.recommendation || '';
            return (
              <Box key={`question:${field}`} flexDirection="column">
                <Markdown text={`**${index + 1}.** ${question.text}`} />
                {question.options && question.options.length > 0 && (
                  <Box flexDirection="row" gap={1}>
                    {question.options.map((option, choice) => (
                      <Button
                        key={`option:${field}/${choice}`}
                        variant={value === option ? 'primary' : undefined}
                        onPress={() => actions.draft(field, option)}
                      >
                        {option}
                        {question.recommendation === option ? ' · recommended' : ''}
                      </Button>
                    ))}
                  </Box>
                )}
                {Input && (
                  <Input
                    key={`answer-input:${field}`}
                    label="Answer: "
                    placeholder="pick an option or type"
                    value={value}
                    submitLabel="answer"
                    onInput={(text) => actions.draft(field, text)}
                    onSubmit={(text) => actions.answer(runId, slug, text, index)}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      );
    }
    if (!item.question) return null;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={ATTENTION_COLOR} paddingX={1}>
        <Markdown text={item.question} />
        {Input && (
          <Input
            key={`answer-input:${key}`}
            label="Answer: "
            placeholder="type the answer, Enter sends"
            value={model.drafts[key] ?? ''}
            submitLabel="answer"
            onInput={(text) => actions.draft(key, text)}
            onSubmit={(text) => actions.answer(runId, slug, text)}
          />
        )}
      </Box>
    );
  }
}
