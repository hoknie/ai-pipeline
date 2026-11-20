import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAgyRuntime } from '../../../src/feature/agents/clients/agy/index.ts';
import { agyToolDecision } from '../../../src/feature/agents/clients/agy/guard.ts';
import { createClaudeRuntime } from '../../../src/feature/agents/clients/claude/index.ts';
import { createOpencodeRuntime } from '../../../src/feature/agents/clients/opencode/index.ts';
import { userMessage, type StepInput } from '../../../src/feature/agents/types/index.ts';
import { agyContext } from './agy-context.ts';

const FOLDER = '/work/aip/logs/r1/_attachments';
const FILES = [
  { fileName: 'shot.png', size: 2048, mediaType: 'image/png' },
  { fileName: 'spec.pdf', size: 3 * 1024 * 1024, mediaType: 'application/pdf' },
];

function input(overrides: Partial<StepInput> = {}): StepInput {
  return { ...agyContext().input, ...overrides };
}

function context(
  runtime: 'claude' | 'opencode' | 'agy',
  permissions: 'read' | 'edit' | 'full',
  attachments: boolean,
  root = '/state',
) {
  const base = agyContext(root);
  return {
    ...base,
    specialist: { ...base.specialist, runtime, permissions },
    input: input(attachments ? { attachments: FILES } : {}),
    attachmentsDirectory: attachments ? FOLDER : null,
  };
}

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('Attachments section of the message', () => {
  it('lists the path, the size and the type of every file after the task', () => {
    const message = userMessage(input({ attachments: FILES, feedback: 'fix it' }), FOLDER);
    expect(message).toContain('## Attachments');
    expect(message).toContain(`- ${FOLDER}/shot.png (2.0 KB, image/png)`);
    expect(message).toContain(`- ${FOLDER}/spec.pdf (3.0 MB, application/pdf)`);
    expect(message.indexOf('Implement login')).toBeLessThan(message.indexOf('## Attachments'));
    expect(message.indexOf('## Attachments')).toBeLessThan(message.indexOf('## Feedback'));
  });

  it('is the old message without attachments, or without a folder', () => {
    const plain = userMessage(input());
    expect(plain).toBe('Implement login');
    expect(userMessage(input({ attachments: FILES }), null)).toBe(plain);
    expect(userMessage(input({ attachments: [] }), FOLDER)).toBe(plain);
  });
});

describe('Claude Code', () => {
  const launch = (permissions: 'read' | 'edit' | 'full', attachments = true) =>
    createClaudeRuntime().buildLaunch(context('claude', permissions, attachments));

  it('gets the folder and the message', () => {
    const { args } = launch('read');
    expect(after(args, '--add-dir')).toBe(FOLDER);
    expect(args[args.indexOf('-p') + 1]).toContain('## Attachments');
  });

  it('may read the folder at the levels read and edit', () => {
    for (const permissions of ['read', 'edit'] as const) {
      const { args } = launch(permissions);
      const allowed = args.slice(args.indexOf('--allowedTools') + 1);
      expect(allowed).toContain(`Read(/${FOLDER}/**)`);
    }
  });

  it('has no folder and no rule without attachments', () => {
    const { args } = launch('read', false);
    expect(args).not.toContain('--add-dir');
    expect(args.join(' ')).not.toContain('_attachments');
  });
});

describe('OpenCode', () => {
  const config = (permissions: 'read' | 'edit' | 'full', attachments = true) => {
    const launch = createOpencodeRuntime().buildLaunch(
      context('opencode', permissions, attachments),
    );
    const agent = (JSON.parse(launch.files[0]!.content) as { agent: Record<string, never> }).agent;
    return {
      launch,
      permission: Object.values(agent)[0]!['permission'] as Record<string, unknown>,
    };
  };

  it('allows the external folder at every level, keeping read-only edit and bash', () => {
    for (const permissions of ['read', 'edit', 'full'] as const) {
      const { permission } = config(permissions);
      expect(permission['external_directory']).toEqual({ [`${FOLDER}/**`]: 'allow' });
    }
    expect(config('read').permission).toMatchObject({ edit: 'deny', bash: 'deny' });
    expect(config('read').launch.args.at(-1)).toContain('## Attachments');
  });

  it('has no rule without attachments', () => {
    expect(config('read', false).permission['external_directory']).toBeUndefined();
  });
});

describe('agy', () => {
  function prepare(permissions: 'read' | 'edit' | 'full', attachments = true) {
    const root = mkdtempSync(join(tmpdir(), 'aip-agy-att-'));
    const ctx = context('agy', permissions, attachments, root);
    mkdirSync(ctx.worktree, { recursive: true });
    const launch = createAgyRuntime().buildLaunch(ctx);
    for (const file of launch.files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content);
    }
    const policyFile = launch.files.find((file) => file.path.endsWith('policy.json'))!.path;
    const policy = JSON.parse(readFileSync(policyFile, 'utf8')) as unknown;
    return { ctx, launch, policy };
  }

  it('adds the folder next to its own and lets the guard read it, but not write there', () => {
    const { launch, policy, ctx } = prepare('read');
    const dirs = launch.args.flatMap((arg, index) =>
      arg === '--add-dir' ? [launch.args[index + 1]] : [],
    );
    expect(dirs).toContain(FOLDER);
    expect(dirs).toHaveLength(2);
    const decide = (name: string, args: Record<string, unknown>) =>
      agyToolDecision(policy, { toolCall: { name, args } }).decision;
    expect(decide('view_file', { AbsolutePath: `${FOLDER}/shot.png` })).toBe('auto_approve');
    expect(decide('view_file', { AbsolutePath: `${ctx.worktree}/a.ts` })).toBe('auto_approve');
    expect(decide('view_file', { AbsolutePath: '/work/aip/logs/r1/other/x' })).toBe('deny');
    expect(decide('write_to_file', { TargetFile: `${FOLDER}/shot.png` })).toBe('deny');
  });

  it('does not open anything for a task without attachments', () => {
    const { launch, policy } = prepare('read', false);
    expect(launch.args.filter((arg) => arg === '--add-dir')).toHaveLength(1);
    expect(
      agyToolDecision(policy, {
        toolCall: { name: 'view_file', args: { AbsolutePath: `${FOLDER}/a` } },
      }).decision,
    ).toBe('deny');
  });
});
