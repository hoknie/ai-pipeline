import { z } from 'zod';

export const accessRequests = [
  z.object({
    method: z.literal('access_check'),
    params: z.object({
      /** The email of the user to check. */
      user: z.string().trim().min(3).max(320),
      action: z.string().min(1).max(128),
      /** A project: a path or a slug. */
      repository: z.string().min(1).max(4096).optional(),
      /** A run: its project, author, pipeline and tags are the attributes of the resource. */
      run: z.string().min(1).max(128).optional(),
    }),
  }),
  z.object({
    method: z.literal('access_me'),
    params: z.object({ repository: z.string().min(1).max(4096).optional() }).default({}),
  }),
  z.object({ method: z.literal('access_actions'), params: z.object({}).default({}) }),
] as const;

/** The answer of `access_check`: the decision, the rules behind it, the attributes it looked at. */
export interface AccessCheckView {
  user: { id: string; email: string; attributes: Record<string, string[]> };
  action: string;
  decision: 'allow' | 'deny';
  /** `deny` by a rule, `allow` by a rule, or `default`: no rule matched. */
  reason: 'deny' | 'allow' | 'default';
  matched: { id: string; effect: 'allow' | 'deny' }[];
  resource: {
    repository: string | null;
    author: string | null;
    pipeline: string | null;
    tags: string[];
  };
}

/** What the current actor may do: for the panel to turn buttons off. */
export interface AccessMeView {
  actor: 'local' | 'system' | 'user';
  /** The id of the user; `null` for `local` and `system`. */
  userId: string | null;
  repository: string | null;
  actions: string[];
  /** The actions allowed only when the author of the resource is the user. */
  conditional: string[];
  /** The paths of the projects the actor can read; `null`: all of them. */
  repositories: string[] | null;
}

export interface AccessActionView {
  name: string;
  description: string;
  resource: 'global' | 'project' | 'run' | 'task';
}

export interface AccessActionsView {
  actions: AccessActionView[];
}
