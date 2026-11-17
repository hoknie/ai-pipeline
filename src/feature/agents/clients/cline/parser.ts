import type { OutputParser, RunOutcome, Usage } from '../../types/index.ts';
import { clineEvent, requestTokens, sessionOf } from './events.ts';

/** Reads the NDJSON of Cline: the task id, the tokens of the requests of this process and errors. */
class ClineParser implements OutputParser {
  private sessionId: string | null = null;
  private total: Usage | null = null;
  private error: string | null = null;

  push(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = clineEvent.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    this.sessionId ??= sessionOf(event);
    const used = requestTokens(event);
    if (used) {
      this.total = {
        inputTokens: (this.total?.inputTokens ?? 0) + used.input,
        outputTokens: (this.total?.outputTokens ?? 0) + used.output,
      };
    }
    if (event.say === 'error' || event.type === 'error') {
      this.error = (event.text ?? event.error ?? 'cline: error').slice(0, 500);
    }
  }

  usage(): Usage | null {
    return this.total === null ? null : { ...this.total };
  }

  outcome(): RunOutcome {
    return { sessionId: this.sessionId, usage: this.usage(), error: this.error, denials: [] };
  }
}

export function createClineParser(): OutputParser {
  return new ClineParser();
}
