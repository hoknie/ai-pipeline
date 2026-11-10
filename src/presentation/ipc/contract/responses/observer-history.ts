import type { AttemptHistoryItem } from '../../../../feature/runs/types/index.ts';

export interface ObserverHistoryView {
  items: AttemptHistoryItem[];
  nextCursor: string | null;
  limit: 20 | 50 | 100;
  projects: string[];
  asOf: number;
}
