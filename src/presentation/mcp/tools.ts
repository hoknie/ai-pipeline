import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { errorMessage } from '../../platform/errors/index.ts';

export type Send = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

export function failure(error: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: errorMessage(error) }],
    isError: true,
  };
}

export async function attempt(work: () => Promise<string>): Promise<CallToolResult> {
  try {
    return text(await work());
  } catch (error) {
    return failure(error);
  }
}
