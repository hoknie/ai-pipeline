import { z } from 'zod';

import type { Denial, OutputParser, RunOutcome, Usage } from '../../types/index.ts';

const tokenUsage = z.looseObject({
  input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
});

const resultEvent = z.looseObject({
  type: z.literal('result'),
  session_id: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  permission_denials: z.unknown().optional(),
  usage: tokenUsage.optional(),
});

const assistantUsage = z.looseObject({
  type: z.literal('assistant'),
  message: z.looseObject({ id: z.string().optional(), usage: tokenUsage.optional() }),
});

const rateLimitInfo = z.looseObject({
  status: z.string().optional(),
  resetsAt: z.number().optional(),
});

/** An API error of a message or a result: `usage_limit_reached` or a rejected `rate_limit`. */
const apiError = z.looseObject({
  error: z.string().optional(),
  api_error: z.string().optional(),
  api_error_params: z.looseObject({ rate_limit_info: rateLimitInfo.optional() }).optional(),
});

const sessionEvent = z.looseObject({ type: z.string(), session_id: z.string() });

const deniedCall = z.looseObject({
  tool_name: z.string(),
  tool_use_id: z.string().optional(),
  tool_input: z.unknown().optional(),
});

const deniedEvent = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('permission_denied'),
  tool_use_id: z.string().optional(),
  tool_name: z.string().optional(),
});

const toolUseMessage = z.looseObject({
  type: z.literal('assistant'),
  message: z.looseObject({ content: z.array(z.unknown()) }),
});

const toolUseBlock = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown().optional(),
});

/** The usage limit of an event, if it says the limit ran out; `resetsAt` in ms. */
function exhaustedLimit(value: unknown): { resetsAt: number | null } | null {
  const parsed = apiError.safeParse(value);
  if (!parsed.success) return null;
  const event = parsed.data;
  const info = event.api_error_params?.rate_limit_info;
  const exhausted =
    event.api_error === 'usage_limit_reached' ||
    (event.error === 'rate_limit' && info?.status === 'rejected');
  if (!exhausted) return null;
  return { resetsAt: info?.resetsAt === undefined ? null : info.resetsAt * 1000 };
}

function commandOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : null;
}

/** Fresh input tokens and tokens written to the cache; cache reads are not counted. */
function inputTokens(tokens: z.infer<typeof tokenUsage> | undefined): number {
  return (tokens?.input_tokens ?? 0) + (tokens?.cache_creation_input_tokens ?? 0);
}

/** Refused tool calls of a stream, each once: Claude Code reports them as events and in the result. */
class Denials {
  private readonly calls = new Map<string, { tool: string; command: string | null }>();
  private readonly byId = new Map<string, Denial>();
  private readonly list: Denial[] = [];

  toolUse(id: string, tool: string, input: unknown): void {
    this.calls.set(id, { tool, command: commandOf(input) });
  }

  add(id: string | undefined, tool: string | undefined, input: unknown): void {
    const call = id !== undefined ? this.calls.get(id) : undefined;
    const denial: Denial = {
      tool: tool ?? call?.tool ?? 'unknown',
      command: commandOf(input) ?? call?.command ?? null,
    };
    if (id === undefined) {
      this.list.push(denial);
      return;
    }
    const known = this.byId.get(id);
    if (known) {
      if (known.command === null) known.command = denial.command;
      if (known.tool === 'unknown') known.tool = denial.tool;
      return;
    }
    this.byId.set(id, denial);
    this.list.push(denial);
  }

  values(): Denial[] {
    return this.list.map((denial) => ({ ...denial }));
  }
}

/** Reads the `stream-json` output of Claude Code line by line. */
class ClaudeParser implements OutputParser {
  private sessionId: string | null = null;
  /** Final usage of the `result` event; overrides the sum of messages. */
  private finalUsage: Usage | null = null;
  /** Usage by assistant message id: a message arrives in several events, the last is full. */
  private readonly messages = new Map<string, Usage>();
  private readonly anonymous: Usage[] = [];
  private error: string | null = null;
  private usageLimit: { resetsAt: number | null } | null = null;
  private readonly denials = new Denials();

  push(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const limit = exhaustedLimit(value);
    if (limit !== null) {
      this.usageLimit = { resetsAt: limit.resetsAt ?? this.usageLimit?.resetsAt ?? null };
    }
    this.messageUsage(value);
    this.toolUses(value);
    const denied = deniedEvent.safeParse(value);
    if (denied.success) {
      this.denials.add(denied.data.tool_use_id, denied.data.tool_name, undefined);
      return;
    }
    const result = resultEvent.safeParse(value);
    if (result.success) {
      this.result(result.data);
      return;
    }
    const session = sessionEvent.safeParse(value);
    if (session.success) this.sessionId = session.data.session_id;
  }

  usage(): Usage | null {
    if (this.finalUsage !== null) return { ...this.finalUsage };
    const all = [...this.messages.values(), ...this.anonymous];
    if (all.length === 0) return null;
    return {
      inputTokens: all.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: all.reduce((sum, item) => sum + item.outputTokens, 0),
      costUsd: null,
    };
  }

  outcome(): RunOutcome {
    return {
      sessionId: this.sessionId,
      usage: this.usage(),
      error: this.error,
      denials: this.denials.values(),
      usageLimit: this.usageLimit,
    };
  }

  private messageUsage(value: unknown): void {
    const assistant = assistantUsage.safeParse(value);
    if (!assistant.success || !assistant.data.message.usage || this.finalUsage !== null) return;
    const tokens = assistant.data.message.usage;
    const entry: Usage = {
      inputTokens: inputTokens(tokens),
      outputTokens: tokens.output_tokens ?? 0,
      costUsd: null,
    };
    const id = assistant.data.message.id;
    if (id === undefined) this.anonymous.push(entry);
    else this.messages.set(id, entry);
  }

  private toolUses(value: unknown): void {
    const toolUse = toolUseMessage.safeParse(value);
    if (!toolUse.success) return;
    for (const block of toolUse.data.message.content) {
      const parsed = toolUseBlock.safeParse(block);
      if (parsed.success) this.denials.toolUse(parsed.data.id, parsed.data.name, parsed.data.input);
    }
  }

  private result(event: z.infer<typeof resultEvent>): void {
    if (Array.isArray(event.permission_denials)) {
      for (const item of event.permission_denials) {
        const call = deniedCall.safeParse(item);
        if (call.success) {
          this.denials.add(call.data.tool_use_id, call.data.tool_name, call.data.tool_input);
        }
      }
    }
    this.sessionId = event.session_id ?? this.sessionId;
    const tokens = event.usage;
    if (tokens || event.total_cost_usd !== undefined) {
      this.finalUsage = {
        inputTokens: inputTokens(tokens),
        outputTokens: tokens?.output_tokens ?? 0,
        costUsd: event.total_cost_usd ?? null,
      };
    }
    if (event.is_error) {
      this.error = typeof event.result === 'string' ? event.result : 'claude reported an error';
    }
  }
}

export function createClaudeParser(): OutputParser {
  return new ClaudeParser();
}
