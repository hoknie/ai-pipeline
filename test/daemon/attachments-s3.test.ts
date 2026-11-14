import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AttachmentContentView,
  RunQueued,
} from '../../src/presentation/ipc/contract/index.ts';
import { startFakeS3Server } from '../fakes/s3-server.ts';
import { CODE_ONLY_CONFIG, harness } from './harness.ts';

const credentials = { accessKeyId: 'test-access', secretAccessKey: 'test-secret' };

describe('daemon with S3 attachments', () => {
  it('writes to S3, delivers bytes to a specialist and removes a queued task object', async () => {
    const s3 = await startFakeS3Server(credentials);
    const h = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`, {
      AWS_ACCESS_KEY_ID: credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    });
    try {
      const ping = await h.call('ping', {});
      expect(ping).toMatchObject({ attachments: { s3Credentials: true } });
      expect(JSON.stringify(ping)).not.toContain(credentials.accessKeyId);
      expect(JSON.stringify(ping)).not.toContain(credentials.secretAccessKey);
      const config = join(h.environment.XDG_CONFIG_HOME!, 'aip', 'settings.yaml');
      mkdirSync(join(h.environment.XDG_CONFIG_HOME!, 'aip'), { recursive: true });
      writeFileSync(
        config,
        `attachments:\n  storage: s3\n  s3:\n    bucket: photos\n    endpoint: ${s3.endpoint}\n    path_style: true\n`,
      );
      const source = join(h.state, 'image.png');
      const picture = Buffer.alloc(2048, 7);
      writeFileSync(source, picture);
      h.environment.AIP_FAKE_ARGV_LOG = join(h.state, 'argv.jsonl');
      h.script({ code: [{}] });
      const queued = (await h.call('run', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'read image',
        attachments: [{ path: source }],
      })) as RunQueued;
      const runId = queued.run!.runId;
      const finished = await h.waitFor(runId, (view) => view.finished);
      const id = finished.attachments[0]!.id;
      expect(s3.objects.get(`photos/aip/attachments/${id}`)).toEqual(picture);
      const content = (await h.call('attachment', { runId, id })) as AttachmentContentView;
      expect(Buffer.from(content.base64, 'base64')).toEqual(picture);
      const calls = readFileSync(h.environment.AIP_FAKE_ARGV_LOG, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { argv: string[] });
      const message = calls
        .map(({ argv }) => argv[argv.indexOf('-p') + 1] ?? '')
        .find((text) => text.includes('## Attachments'))!;
      const inWorkspace = message.match(/- (\S+image\.png) \(/)?.[1];
      expect(inWorkspace).toBeDefined();
      expect(readFileSync(inWorkspace!)).toEqual(picture);

      const task = (await h.call('queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'waiting',
        attachments: [{ path: source }],
      })) as { item: string; items: { id: string; attachments: { id: string }[] }[] };
      const waiting = task.items.find((entry) => entry.id === task.item)!;
      const waitingId = waiting.attachments[0]!.id;
      expect(s3.objects.has(`photos/aip/attachments/${waitingId}`)).toBe(true);
      await h.call('queue_remove', { repository: h.repo, item: waiting.id });
      expect(s3.objects.has(`photos/aip/attachments/${waitingId}`)).toBe(false);
    } finally {
      await h.close();
      await s3.close();
    }
  });

  it('edits a task to detach a local file after switching to S3 without credentials', async () => {
    const h = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    try {
      const source = join(h.state, 'old.txt');
      writeFileSync(source, 'old');
      const added = (await h.call('queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'waiting',
        attachments: [{ path: source }],
      })) as { item: string; items: { id: string; attachments: { id: string }[] }[] };
      const id = added.items.find((item) => item.id === added.item)!.attachments[0]!.id;
      const config = join(h.environment.XDG_CONFIG_HOME!, 'aip', 'settings.yaml');
      mkdirSync(join(h.environment.XDG_CONFIG_HOME!, 'aip'), { recursive: true });
      writeFileSync(config, 'attachments:\n  storage: s3\n  s3:\n    bucket: photos\n');
      const edited = (await h.call('queue_edit', {
        repository: h.repo,
        item: added.item,
        detach: ['old.txt'],
      })) as { items: { id: string; attachments: unknown[] }[] };
      expect(edited.items.find((item) => item.id === added.item)?.attachments).toEqual([]);
      expect(id).toBeTruthy();
    } finally {
      await h.close();
    }
  });
});
