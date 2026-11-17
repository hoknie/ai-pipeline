import type { OutputParser, RunOutcome, Usage } from '../../types/index.ts';

import { opencodeErrorText } from './transcript.ts';

function numberAt(value: unknown, ...path: string[]): number | null {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' ? current : null;
}

function findSession(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['sessionID', 'sessionId', 'session_id']) {
    if (typeof record[key] === 'string') return record[key];
  }
  for (const nested of Object.values(record)) {
    const found = findSession(nested);
    if (found) return found;
  }
  return null;
}

function findStepFinish(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if ((record.type === 'step-finish' || record.type === 'step_finish') && 'tokens' in record)
    return record;
  for (const nested of Object.values(record)) {
    const found = findStepFinish(nested);
    if (found) return found;
  }
  return null;
}

/** The usage so far plus the tokens of one finished step. */
function addStep(usage: Usage | null, step: Record<string, unknown>): Usage {
  const input =
    (numberAt(step, 'tokens', 'input') ?? 0) + (numberAt(step, 'tokens', 'cache', 'write') ?? 0);
  const output =
    (numberAt(step, 'tokens', 'output') ?? 0) + (numberAt(step, 'tokens', 'reasoning') ?? 0);
  return {
    inputTokens: (usage?.inputTokens ?? 0) + input,
    outputTokens: (usage?.outputTokens ?? 0) + output,
  };
}

/** The text of a `text` part event (`{ type: 'text', part: { type: 'text', text } }`), if not blank. */
function textPart(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  const part =
    typeof event.part === 'object' && event.part !== null
      ? (event.part as Record<string, unknown>)
      : event;
  if (part.type !== 'text' || typeof part.text !== 'string') return null;
  return part.text.trim() ? part.text : null;
}

/** Reads the `run --format json` output of OpenCode line by line. */
class OpencodeParser implements OutputParser {
  private sessionId: string | null = null;
  private current: Usage | null = null;
  private error: string | null = null;
  /** The last non-empty text part of the answer. */
  private reply: string | null = null;

  push(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    this.sessionId ??= findSession(value);
    const step = findStepFinish(value);
    if (step) this.current = addStep(this.current, step);
    const text = textPart(value);
    if (text !== null) this.reply = text;
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<string, unknown>).type === 'error'
    ) {
      const error = (value as Record<string, unknown>).error ?? value;
      this.error = opencodeErrorText(error).slice(0, 500);
    }
  }

  usage(): Usage | null {
    return this.current === null ? null : { ...this.current };
  }

  outcome(): RunOutcome {
    return {
      sessionId: this.sessionId,
      usage: this.usage(),
      error: this.error,
      denials: [],
      reply: this.reply,
    };
  }
}

export function createOpencodeParser(): OutputParser {
  return new OpencodeParser();
}
