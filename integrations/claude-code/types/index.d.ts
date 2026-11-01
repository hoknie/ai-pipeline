export type AipGroupStatus =
  'queued' | 'running' | 'needs_human' | 'merging' | 'merged' | 'conflict' | 'failed' | 'cancelled';

export type AipDeliveryState = 'pending' | 'applied' | 'apply_failed';

export type AipUsage = { inputTokens: number; outputTokens: number; costUsd: number | null };

export type AipQuestion = {
  text: string;
  options?: string[] | null;
  recommendation?: string | null;
};

export type AipDiff = { files: number; added: number; removed: number };

export type AipGroup = {
  slug: string;
  title: string;
  status: AipGroupStatus;
  step: string | null;
  round: number | null;
  durationMs: number;
  question: string | null;
  reason: string | null;
  warnings: number;
  delivery: AipDeliveryState;
  diff?: AipDiff | null;
  questions?: AipQuestion[] | null;
};

export type AipRun = {
  id: string;
  title?: string | null;
  name?: string | null;
  state?: string;
  waiting?: number;
  diff?: AipDiff | null;
  repository: string;
  workflow: string;
  branch: string;
  createdAt: number;
  finishedAt: number | null;
  finished: boolean;
  dirtyWarning: boolean;
  counts: string;
  total: number;
  usage: AipUsage | null;
  split: {
    status: AipGroupStatus | 'done';
    question: string | null;
    reason: string | null;
    questions?: AipQuestion[] | null;
  } | null;
  delivery: { applied: number; merged: number; failed: number; inProgress: boolean };
  groups: AipGroup[];
};

export type AipEvent =
  { event: 'snapshot'; seq: number; runs: AipRun[] } | { event: 'run'; seq: number; run: AipRun };

export type AipConnection = {
  mode: 'connecting' | 'stream' | 'polling' | 'missing';
  error: string | null;
};

export type AipActionResult = { id: number; text: string; isError: boolean };

declare module 'claude-code' {
  interface PluginState {
    aip: {
      runs: Shaped<AipRun[]>;
      isLoaded: boolean;
      selectedRun: string | null;
      connection: Shaped<AipConnection>;
      notified: Shaped<string[]>;
      drafts: Shaped<Record<string, string>>;
      actionResult: Shaped<AipActionResult | null>;
      pending: Shaped<string[]>;
    };
  }
}
