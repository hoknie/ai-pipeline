import type { OutputParser, RunOutcome, Usage } from '../../types/index.ts';
import { agyEvent } from './events.ts';

/** Antigravity reports token totals including thinking; cache reads are not added a second time. */
function usageOf(tokens: { input_tokens?: number; output_tokens?: number }): Usage {
  return {
    inputTokens: tokens.input_tokens ?? 0,
    outputTokens: tokens.output_tokens ?? 0,
    costUsd: null,
  };
}

class AgyParser implements OutputParser {
  private sessionId: string | null = null;
  private error: string | null = null;
  private finalUsage: Usage | null = null;
  private readonly steps = new Map<number, Usage>();

  push(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = agyEvent.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.event === 'init') this.sessionId = event.conversation_id || this.sessionId;
    if (event.event === 'step_update') {
      const step = event.step_update;
      this.sessionId = step.conversation_id || this.sessionId;
      if (step.usage) this.steps.set(step.step_index, usageOf(step.usage));
    }
    if (event.event === 'result') {
      const result = event.result;
      this.sessionId = result.conversation_id || this.sessionId;
      // On resume the result is cumulative over the conversation, not this attempt.
      if (result.usage && (result.num_turns ?? 1) <= 1) this.finalUsage = usageOf(result.usage);
      if (result.status !== 'SUCCESS')
        this.error = result.error || `agy reported status ${result.status}`;
    }
  }

  usage(): Usage | null {
    if (this.finalUsage) return { ...this.finalUsage };
    if (this.steps.size === 0) return null;
    return [...this.steps.values()].reduce<Usage>(
      (total, usage) => ({
        inputTokens: total.inputTokens + usage.inputTokens,
        outputTokens: total.outputTokens + usage.outputTokens,
        costUsd: null,
      }),
      { inputTokens: 0, outputTokens: 0, costUsd: null },
    );
  }

  outcome(): RunOutcome {
    return { sessionId: this.sessionId, usage: this.usage(), error: this.error, denials: [] };
  }
}

export function createAgyParser(): OutputParser {
  return new AgyParser();
}
