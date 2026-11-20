import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DUPLICATE_TASK_CODE } from '../../feature/queue/types/index.ts';
import { errorMessage } from '../../platform/errors/index.ts';
import { IpcError } from '../ipc/client/index.ts';

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

/** The parameter of the host tools that adds a task whose copy already waits in the queue. */
export const ALLOW_DUPLICATE =
  'true: add the task even when the same one (pipeline, variant, provider and text or groups) already waits in the queue; without it such a copy is refused';

/** Runs `work`; the refusal of a task that already waits in the queue gets `hint`, the way out. */
export async function hintDuplicate<T>(hint: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IpcError && error.remoteCode === DUPLICATE_TASK_CODE) {
      throw new IpcError(`${error.message}; ${hint}`, { code: error.remoteCode });
    }
    throw error;
  }
}

/** The way out for a host: the copy is added when it is asked for. */
export const HOST_DUPLICATE_HINT = 'pass allowDuplicate: true to add it again';
