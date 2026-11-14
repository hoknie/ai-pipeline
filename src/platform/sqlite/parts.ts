import { ATTACHMENTS_MIGRATION } from './attachments-migration.ts';

export { STATS_MIGRATION } from './stats-migration.ts';

/** The migrations after the usage journal: the queue filter, pipeline variants, attachments. */
export const LATER_MIGRATIONS: string[] = [
  `ALTER TABLE queues ADD COLUMN filter_json TEXT NOT NULL DEFAULT '{"pipelines":[],"tags":[]}'`,
  `ALTER TABLE runs ADD COLUMN variant TEXT NOT NULL DEFAULT 'default'; ALTER TABLE queue_items ADD COLUMN variant TEXT NOT NULL DEFAULT 'default'`,
  ATTACHMENTS_MIGRATION,
];
