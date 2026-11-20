import { ATTACHMENTS_MIGRATION } from './attachments-migration.ts';
import { IDENTITY_MIGRATION } from './identity-migration.ts';
import {
  INTEGRATIONS_MIGRATION,
  NOTIFICATIONS_MIGRATION,
  SERVICE_REGISTRY_LINKS_MIGRATION,
  WEBHOOKS_MIGRATION,
} from './integrations-migration.ts';
import { TASK_LINKS_MIGRATION } from './links-migration.ts';
import { AUTHORSHIP_MIGRATION } from './authorship-migration.ts';
import { SAML_MIGRATION } from './saml-migration.ts';
import { STATS_AUTHOR_MIGRATION } from './stats-migration.ts';
import { SSO_MIGRATION } from './sso-migration.ts';

export { STATS_MIGRATION } from './stats-migration.ts';

/** The migrations after the usage journal: the queue filter, pipeline variants, attachments, the removal of the cost, the chain item of an attempt. */
export const LATER_MIGRATIONS: string[] = [
  `ALTER TABLE queues ADD COLUMN filter_json TEXT NOT NULL DEFAULT '{"pipelines":[],"tags":[]}'`,
  `ALTER TABLE runs ADD COLUMN variant TEXT NOT NULL DEFAULT 'default'; ALTER TABLE queue_items ADD COLUMN variant TEXT NOT NULL DEFAULT 'default'`,
  ATTACHMENTS_MIGRATION,
  `
  CREATE TABLE global_queue (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'stopped',
    parallel INTEGER NOT NULL DEFAULT 1,
    autopilot INTEGER NOT NULL DEFAULT 0,
    auto_answer INTEGER NOT NULL DEFAULT 0,
    skip_failed INTEGER NOT NULL DEFAULT 0,
    autopilot_answer TEXT,
    on_limit TEXT NOT NULL DEFAULT 'wait',
    filter_json TEXT NOT NULL DEFAULT '{"pipelines":[],"projects":[]}',
    runs_json TEXT NOT NULL DEFAULT '[]',
    priority_json TEXT NOT NULL DEFAULT '[]',
    acknowledged_json TEXT NOT NULL DEFAULT '[]',
    skipped_json TEXT NOT NULL DEFAULT '[]',
    stop_json TEXT,
    applied_scope TEXT NOT NULL DEFAULT 'project',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO global_queue (id) VALUES (1);
  ALTER TABLE queue_items ADD COLUMN global_position INTEGER;
  `,
  `
  ALTER TABLE stats_attempts DROP COLUMN cost_usd;
  UPDATE attempts SET usage_json = json_remove(usage_json, '$.costUsd') WHERE usage_json IS NOT NULL;
  UPDATE runs SET naming_usage_json = json_remove(naming_usage_json, '$.costUsd') WHERE naming_usage_json IS NOT NULL;
  `,
  TASK_LINKS_MIGRATION,
  `ALTER TABLE attempts ADD COLUMN chain_index INTEGER; ALTER TABLE attempts ADD COLUMN provider TEXT`,
  `ALTER TABLE runs ADD COLUMN provider TEXT; ALTER TABLE queue_items ADD COLUMN provider TEXT; ALTER TABLE attempts ADD COLUMN requested_provider TEXT`,
  // the generation of a conversation of a CLI that keeps its own history; old rows stay NULL
  `ALTER TABLE attempts ADD COLUMN generation INTEGER NULL`,
  INTEGRATIONS_MIGRATION,
  IDENTITY_MIGRATION,
  SSO_MIGRATION,
  SAML_MIGRATION,
  AUTHORSHIP_MIGRATION,
  STATS_AUTHOR_MIGRATION,
  // the branch of a run in the remote repository once it is sent there (JSON); old rows have none
  `ALTER TABLE runs ADD COLUMN remote_branch_json TEXT`,
  NOTIFICATIONS_MIGRATION,
  WEBHOOKS_MIGRATION,
  // the outcome of the last check of an integration connection; a connection never checked has no row
  `CREATE TABLE IF NOT EXISTS integration_connection_checks (
    connection_id TEXT PRIMARY KEY REFERENCES integration_connections (id) ON DELETE CASCADE,
    checked_at INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    code TEXT,
    count INTEGER
  )`,
  // the versions of registry skills fixed for a run (JSON by skill name); old rows have none
  `ALTER TABLE runs ADD COLUMN pinned_skills_json TEXT`,
  SERVICE_REGISTRY_LINKS_MIGRATION,
];
