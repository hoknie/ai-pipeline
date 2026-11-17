import type { OutputParser, RunOutcome, Usage } from '../../types/index.ts';
import { copilotEvent } from './events.ts';

/**
 * Reads the JSONL of Copilot: the id of the session from its start event, the tokens of this
 * process and errors. With `expected` (a resumed conversation) the stream must name the same id;
 * a different id, or none, is an error: a conversation is never replaced by another one.
 */
class CopilotParser implements OutputParser {
  private sessionId: string | null = null;
  private total: Usage | null = null;
  private error: string | null = null;
  private readonly expected: string | null;

  constructor(expected: string | null) {
    this.expected = expected;
  }

  push(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = copilotEvent.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === 'session.start') this.sessionId ??= event.data.sessionId;
    else if (event.type === 'assistant.usage') {
      this.total = {
        inputTokens: (this.total?.inputTokens ?? 0) + (event.data.inputTokens ?? 0),
        outputTokens: (this.total?.outputTokens ?? 0) + (event.data.outputTokens ?? 0),
      };
    } else if (event.type === 'session.error') {
      this.error = (event.data.message ?? 'copilot: error').slice(0, 500);
    }
  }

  usage(): Usage | null {
    return this.total === null ? null : { ...this.total };
  }

  outcome(): RunOutcome {
    let conversationError: string | null = null;
    let sessionId = this.sessionId;
    if (this.expected !== null && this.sessionId !== this.expected) {
      conversationError =
        this.sessionId === null
          ? `copilot: the stream has no session start; expected session ${this.expected}`
          : `copilot: resumed session ${this.sessionId} is not the stored conversation ${this.expected}`;
      sessionId = null;
    }
    return { sessionId, usage: this.usage(), error: this.error, conversationError, denials: [] };
  }
}

export function createCopilotParser(expected: string | null = null): OutputParser {
  return new CopilotParser(expected);
}
