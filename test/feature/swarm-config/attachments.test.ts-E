import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigService,
  configPaths,
  loadAttachmentSettings,
  loadConfig,
  validateAttachmentsSection,
} from '../../../src/feature/swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
} from '../../../src/feature/swarm-config/types/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-attachments-config-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const pathsOfErrors = (value: unknown) =>
  validateAttachmentsSection(value).errors.map((e) => e.path);

describe('attachment settings', () => {
  it('defaults to local storage when the section or file is absent', () => {
    const paths = setup();
    const expected = {
      storage: 'local',
      s3: {
        bucket: null,
        region: 'us-east-1',
        endpoint: null,
        prefix: 'aip/attachments/',
        pathStyle: false,
      },
    };
    expect(loadAttachmentSettings(paths)).toEqual(expected);
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadAttachmentSettings(paths)).toEqual(expected);
  });

  it('loads the shared section independently of unrelated errors and rereads changes', () => {
    const paths = setup();
    const file = join(paths.global.directory, 'settings.yaml');
    write(
      file,
      'max: 100\nattachments:\n  storage: s3\n  s3:\n    bucket: photos\n    endpoint: http://127.0.0.1:9000\n    path_style: true\n',
    );
    expect(loadAttachmentSettings(paths)).toMatchObject({
      storage: 's3',
      s3: { bucket: 'photos', endpoint: 'http://127.0.0.1:9000', pathStyle: true },
    });
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
    write(file, 'attachments: { storage: local }\n');
    expect(loadAttachmentSettings(paths).storage).toBe('local');
  });

  it('requires a bucket when S3 is selected, but not for local', () => {
    expect(pathsOfErrors({ storage: 's3' })).toContain('swarm.attachments.s3.bucket');
    expect(pathsOfErrors({ storage: 'local' })).toEqual([]);
  });

  it('rejects unknown keys, including credentials in the config', () => {
    expect(pathsOfErrors({ unknown: 1, s3: { secret_access_key: 'secret' } })).toEqual([
      'swarm.attachments.unknown',
      'swarm.attachments.s3.secret_access_key',
    ]);
  });

  it('checks the URL, prefix, choice and field types', () => {
    expect(
      pathsOfErrors({ storage: 'else', s3: { endpoint: 'ftp://example.com', prefix: '/root' } }),
    ).toEqual([
      'swarm.attachments.storage',
      'swarm.attachments.s3.endpoint',
      'swarm.attachments.s3.prefix',
    ]);
    expect(pathsOfErrors({ s3: { endpoint: 'not a URL', path_style: 'yes', region: '' } })).toEqual(
      [
        'swarm.attachments.s3.endpoint',
        'swarm.attachments.s3.path_style',
        'swarm.attachments.s3.region',
      ],
    );
    expect(pathsOfErrors({ s3: [] })).toEqual(['swarm.attachments.s3']);
  });

  it('rejects the section in a project file and identifies invalid global fields', () => {
    const paths = setup();
    const shared = join(paths.global.directory, 'settings.yaml');
    const project = join(paths.project.directory, 'settings.yaml');
    write(shared, 'attachments: { storage: s3 }\n');
    expect(() => loadAttachmentSettings(paths)).toThrow(ConfigLoadError);
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: dirname(paths.global.directory) },
    });
    expect(service.attachmentSettings()).toContain('swarm.attachments.s3.bucket');
    write(shared, 'max: 2\n');
    write(project, 'attachments: { storage: local }\n');
    try {
      loadConfig(paths);
      throw new Error('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigLoadError);
      const detail = (error as ConfigLoadError).detail;
      expect(detail.kind === 'invalid' ? detail.errors : []).toContainEqual({
        file: project,
        path: 'swarm.attachments',
        message: 'attachments is set only in the global aip/ directory',
      });
    }
    expect(service.attachmentSettings()).toEqual(loadAttachmentSettings(paths));
  });
});
