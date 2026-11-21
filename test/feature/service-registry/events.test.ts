import { describe, expect, it } from 'vitest';

import {
  FIELD_LIMIT,
  RECOVERY_EVENTS,
  ruleOf,
  taskOf,
} from '../../../src/feature/service-registry/types/index.ts';

const PARAMS = {
  on_deployment_drift: 'investigate',
  on_link_check_failed: 'links',
  on_repo_sync_failed: 'sync',
};

describe('rules of events', () => {
  it('names the pipeline of each event that asks for a task', () => {
    expect(ruleOf('deployment.drift', PARAMS)).toEqual({ pipeline: 'investigate' });
    expect(ruleOf('link.check_failed', PARAMS)).toEqual({ pipeline: 'links' });
    expect(ruleOf('repo_sync.failed', PARAMS)).toEqual({ pipeline: 'sync' });
  });

  it('ignores a type without a rule, a recovery and an unknown type', () => {
    expect(ruleOf('link.check_failed', {})).toEqual({ ignore: 'no_rule' });
    expect(ruleOf('deployment.drift', { on_deployment_drift: '' })).toEqual({ ignore: 'no_rule' });
    for (const type of RECOVERY_EVENTS)
      expect(ruleOf(type, PARAMS)).toEqual({ ignore: 'recovery' });
    expect(ruleOf('node.created', PARAMS)).toEqual({ ignore: 'unsupported' });
  });
});

describe('task of an event', () => {
  const base = 'https://registry.example.com';
  const path = 'acme/backend/api';

  it('writes the type, the path, the link and the known fields of a drift', () => {
    const { title, task } = taskOf(
      {
        type: 'deployment.drift',
        data: {
          node: { path },
          environment: 'prod',
          expected_version: '1.2.0',
          actual_version: '1.1.0',
        },
      },
      base,
      path,
    );
    expect(title).toBe('Registry: deployment.drift — acme/backend/api');
    expect(task).toContain('deployment.drift');
    expect(task).toContain(path);
    expect(task).toContain('https://registry.example.com/catalog?node=acme%2Fbackend%2Fapi');
    expect(task).toContain('Environment: prod');
    expect(task).toContain('Expected version: 1.2.0');
    expect(task).toContain('Actual version: 1.1.0');
  });

  it('reads the fields of a link check and of a repository sync', () => {
    const link = taskOf(
      { type: 'link.check_failed', data: { link: { url: 'https://x.example', status: '404' } } },
      base,
      path,
    ).task;
    expect(link).toContain('Link: https://x.example');
    expect(link).toContain('Status: 404');
    const sync = taskOf(
      { type: 'repo_sync.failed', data: { repo_url: 'git@x:a/b.git', error: 'denied' } },
      null,
      path,
    ).task;
    expect(sync).toContain('Repository: git@x:a/b.git');
    expect(sync).toContain('Error: denied');
    expect(sync).not.toContain('catalog?node');
  });

  it('cuts long fields, skips what is not text and never copies unknown fields', () => {
    const { task } = taskOf(
      {
        type: 'repo_sync.failed',
        data: { error: 'e'.repeat(FIELD_LIMIT + 100), repo_url: 5, secret: 'hunter2' },
      },
      base,
      path,
    );
    expect(task).toContain(`${'e'.repeat(FIELD_LIMIT)}…`);
    expect(task).not.toContain('e'.repeat(FIELD_LIMIT + 1));
    expect(task).not.toContain('Repository');
    expect(task).not.toContain('hunter2');
  });

  it('gives the same text for the same data', () => {
    const event = { type: 'deployment.drift', data: { environment: 'prod' } };
    expect(taskOf(event, base, path)).toEqual(taskOf({ ...event }, base, path));
  });
});
