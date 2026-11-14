import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commitEdit,
  editorView,
  planSettings,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { settingFieldOf } from '../../../src/feature/swarm-edit/types/index.ts';
import {
  configPaths,
  loadAttachmentSettings,
} from '../../../src/feature/swarm-config/services/index.ts';

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-attachments-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
};

describe('attachments in the settings editor', () => {
  it('exposes all global-only fields and their defaults', () => {
    const view = editorView(setup());
    const find = (path: string) =>
      view.settings.find((field) => field.path === `attachments.${path}`);
    expect(find('storage')).toMatchObject({
      value: 'local',
      defaultValue: 'local',
      globalOnly: true,
    });
    expect(find('s3.bucket')).toMatchObject({ value: null, globalOnly: true });
    expect(find('s3.region')).toMatchObject({ value: 'us-east-1', globalOnly: true });
    expect(find('s3.endpoint')).toMatchObject({ value: null, globalOnly: true });
    expect(find('s3.prefix')).toMatchObject({ value: 'aip/attachments/', globalOnly: true });
    expect(find('s3.path_style')).toMatchObject({ value: false, globalOnly: true });
    expect(settingFieldOf('attachments.storage')?.options).toEqual(['local', 's3']);
  });

  it('writes and validates S3 settings in the shared file', () => {
    const paths = setup();
    const plan = planSettings(paths, {
      revision: null,
      values: {
        'attachments.storage': 's3',
        'attachments.s3.bucket': 'photos',
        'attachments.s3.endpoint': 'http://127.0.0.1:9000',
        'attachments.s3.path_style': true,
      },
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdit(plan);
    expect(loadAttachmentSettings(paths)).toMatchObject({
      storage: 's3',
      s3: { bucket: 'photos', pathStyle: true },
    });
    expect(
      editorView(paths).settings.find((field) => field.path === 'attachments.s3.bucket')?.written
        .global,
    ).toBe('photos');
  });

  it('rejects a project write and invalid S3 values', () => {
    expect(
      planSettings(setup(), {
        revision: null,
        level: 'project',
        values: { 'attachments.storage': 's3' },
      }),
    ).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.attachments.storage' }],
    });
    const invalid: Record<string, string>[] = [
      { 'attachments.storage': 's3' },
      { 'attachments.s3.endpoint': 'ftp://localhost' },
      { 'attachments.s3.prefix': '/wrong' },
    ];
    for (const values of invalid) {
      expect(planSettings(setup(), { revision: null, values })).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
  });
});
