import type { OutputParser, RunOutcome, Usage } from '../../types/index.ts';
import { codexEvent } from './events.ts';

/** Reads `codex exec --json`: the thread id, the tokens of this process and the failure. */
class CodexParser implements OutputParser {
  private sessionId: string | null = null;
  private total: Usage | null = null;
  private failure: string | null = null;
  private lastError: string | null = null;

  push(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = codexEvent.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === 'thread.started') this.sessionId = event.thread_id;
    else if (event.type === 'turn.completed') {
      // each turn of this process counts once; a resumed thread starts counting again
      this.lastError = null;
      if (event.usage) {
        this.total = {
          inputTokens: (this.total?.inputTokens ?? 0) + (event.usage.input_tokens ?? 0),
          outputTokens: (this.total?.outputTokens ?? 0) + (event.usage.output_tokens ?? 0),
        };
      }
    } else if (event.type === 'turn.failed') {
      this.failure = (event.error?.message ?? 'codex: the turn failed').slice(0, 500);
    } else if (event.type === 'error') {
      this.lastError = (event.message ?? 'codex: error').slice(0, 500);
    }
  }

  usage(): Usage | null {
    return this.total === null ? null : { ...this.total };
  }

  outcome(): RunOutcome {
    return {
      sessionId: this.sessionId,
      usage: this.usage(),
      error: this.failure ?? this.lastError,
      denials: [],
    };
  }
}

export function createCodexParser(): OutputParser {
  return new CodexParser();
}
