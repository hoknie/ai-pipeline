import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  copilotTranscript,
  createCopilotParser,
  createCopilotRuntime,
  sandboxed,
} from '../../../src/feature/agents/clients/copilot/index.ts';
import { conversationContext } from './conversation-context.ts';

const SANDBOX = { AIP_COPILOT_SANDBOX_BIN: '/usr/bin/sandbox-exec' };
const provider = {
  COPILOT_PROVIDER_BASE_URL: 'https://llm.example/v1',
  COPILOT_PROVIDER_API_KEY: 'sk-very-secret',
  GITHUB_TOKEN: 'ghp_secret',
};

describe('Copilot launch', () => {
  it('runs prompt mode with JSON output in a private COPILOT_HOME, sandboxed', () => {
    const context = conversationContext('copilot', { environment: SANDBOX });
    const launch = createCopilotRuntime('/bin/copilot').buildLaunch(context);
    expect(launch.command).toBe('/usr/bin/sandbox-exec');
    expect(launch.args.slice(0, 2)).toEqual([
      '-f',
      join(context.conversationDirectory!, 'sandbox.sb'),
    ]);
    expect(launch.args).toContain('/bin/copilot');
    expect(launch.args).toContain('--output-format=json');
    expect(launch.args).toContain('--no-ask-user');
    expect(launch.args).not.toContain('--continue');
    expect(launch.args).not.toContain('--trust-folder');
    expect(launch.env.COPILOT_HOME).toBe(join(context.conversationDirectory!, 'copilot-home'));
    expect(launch.env.TMPDIR).toBe(join(context.conversationDirectory!, 'tmp'));
  });

  it('passes the provider variables and keeps the GitHub token away from a foreign endpoint', () => {
    const context = conversationContext('copilot', { environment: { ...SANDBOX, ...provider } });
    const launch = createCopilotRuntime().buildLaunch(context);
    expect(launch.env).toMatchObject({
      COPILOT_PROVIDER_BASE_URL: 'https://llm.example/v1',
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_MODEL: 'team-model',
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      COPILOT_GITHUB_TOKEN: '',
    });
    // the provider key stays in the environment of the daemon: not in argv, not in a file
    expect(JSON.stringify([launch.args, launch.files])).not.toContain('sk-very-secret');
    expect(JSON.stringify([launch.args, launch.files])).not.toContain('ghp_secret');
    const plain = createCopilotRuntime().buildLaunch(
      conversationContext('copilot', { environment: SANDBOX }),
    );
    expect(plain.env.GITHUB_TOKEN).toBeUndefined();
  });

  it('needs a model for its own endpoint and an http(s) base URL', () => {
    const noModel = conversationContext('copilot', { environment: { ...SANDBOX, ...provider } });
    noModel.specialist.model = null;
    expect(() => createCopilotRuntime().buildLaunch(noModel)).toThrow(/needs a model/);
    const bad = conversationContext('copilot', {
      environment: { ...SANDBOX, COPILOT_PROVIDER_BASE_URL: 'ftp://x' },
    });
    expect(() => createCopilotRuntime().buildLaunch(bad)).toThrow(/http\(s\)/);
  });

  it('writes the worker and the specialist servers, the gate hook and the policy', () => {
    const context = conversationContext('copilot', { environment: SANDBOX });
    context.specialist.mcp = { graph: { command: '/bin/graph', args: [], env: {} } };
    const launch = createCopilotRuntime().buildLaunch(context);
    const mcp = JSON.parse(launch.files.find((f) => f.path.endsWith('mcp-config.json'))!.content);
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(['aip-attempt-1', 'aip-attempt-1-graph']);
    expect(mcp.mcpServers['aip-attempt-1'].tools).toContain('swarm_report');
    expect(launch.files.map((file) => file.path.split('/').slice(-2).join('/'))).toEqual(
      expect.arrayContaining(['aip/policy.json', 'aip/gate.mjs', 'hooks/aip.json']),
    );
  });

  it('continues by --session-id from the same home and fails without the history', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-copilot-'));
    const context = conversationContext(
      'copilot',
      { environment: SANDBOX, resumeSession: 's-1' },
      root,
    );
    expect(() => createCopilotRuntime().buildLaunch(context)).toThrow(/history .* is missing/);
    mkdirSync(join(context.conversationDirectory!, 'copilot-home', 'session-state'), {
      recursive: true,
    });
    const launch = createCopilotRuntime().buildLaunch(context);
    expect(launch.args).toContain('--session-id=s-1');
    expect(launch.args).not.toContain('--trust-folder');
  });

  it('gives parallel conversations different homes', () => {
    const one = createCopilotRuntime().buildLaunch(
      conversationContext('copilot', { environment: SANDBOX }),
    );
    const two = createCopilotRuntime().buildLaunch(
      conversationContext('copilot', { environment: SANDBOX }),
    );
    expect(one.env.COPILOT_HOME).not.toBe(two.env.COPILOT_HOME);
  });

  it('does not start without a sandbox program: fail-closed', () => {
    const context = conversationContext('copilot', { environment: { PATH: '/nonexistent' } });
    if (process.platform === 'darwin') return;
    expect(() => createCopilotRuntime().buildLaunch(context)).toThrow(/no OS sandbox/);
  });
});

describe('the OS sandbox of Copilot', () => {
  const spec = (platform: NodeJS.Platform, writeWorktree: boolean) => {
    const root = mkdtempSync(join(tmpdir(), 'aip-sandbox-'));
    const worktree = join(root, 'worktree');
    const conversations = join(root, 'conversations');
    const own = join(conversations, 'code-g1-copilot');
    mkdirSync(worktree);
    mkdirSync(own, { recursive: true });
    return {
      root,
      worktree,
      conversations,
      own,
      run: () =>
        sandboxed({
          platform,
          environment: { AIP_COPILOT_SANDBOX_BIN: '/sbx' },
          command: '/bin/copilot',
          args: ['-p', 'x'],
          worktree,
          privateDirectory: own,
          conversationsRoot: conversations,
          writeWorktree,
          profilePath: join(own, 'sandbox.sb'),
          readOnly: [join(own, 'copilot-home', 'aip')],
        }),
    };
  };

  it('writes only the private state at read, and the worktree too at edit (Seatbelt)', () => {
    const read = spec('darwin', false);
    const profile = read.run().files[0]!.content;
    expect(profile).toContain('(deny file-write*)');
    expect(profile).toContain(read.own.replace('/var/', '/private/var/'));
    expect(profile).not.toContain(`(subpath "${read.worktree}")`);
    expect(profile).toMatch(/deny file-read\* \(subpath ".*conversations"\)/);
    expect(profile).toMatch(/deny file-write\* \(subpath ".*copilot-home\/aip"\)/);
    expect(profile.indexOf('(deny file-write* (subpath')).toBeGreaterThan(
      profile.indexOf('(allow file-write*'),
    );
    const edit = spec('darwin', true);
    expect(edit.run().files[0]!.content).toContain('worktree');
    expect(edit.run().args.slice(0, 2)).toEqual(['-f', join(edit.own, 'sandbox.sb')]);
  });

  it('binds the private state and hides the other conversations (bubblewrap)', () => {
    const read = spec('linux', false);
    const args = read.run().args;
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toContain('--unshare-pid');
    const tmpfs = args.indexOf('--tmpfs');
    expect(args[tmpfs + 1]).toMatch(/conversations$/);
    const binds = args.flatMap((arg, index) => (arg === '--bind' ? [args[index + 1]!] : []));
    expect(binds).toHaveLength(1);
    expect(binds[0]).toMatch(/code-g1-copilot$/);
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['/bin/copilot', '-p', 'x']);
    const lastBind = args.lastIndexOf('--bind');
    const guard = args.indexOf('--ro-bind', 3);
    expect(guard).toBeGreaterThan(lastBind);
    expect(args[guard + 1]).toMatch(/copilot-home\/aip$/);
    const edit = spec('linux', true).run().args;
    expect(edit.filter((arg) => arg === '--bind')).toHaveLength(2);
  });

  it('refuses a platform without a sandbox', () => {
    const windows = spec('win32', true);
    expect(() =>
      sandboxed({
        platform: 'win32',
        environment: {},
        command: 'copilot',
        args: [],
        worktree: windows.worktree,
        privateDirectory: windows.own,
        conversationsRoot: windows.conversations,
        writeWorktree: true,
        profilePath: join(windows.own, 'p'),
      }),
    ).toThrow(/no OS sandbox/);
  });
});

describe('Copilot output', () => {
  const start = JSON.stringify({ type: 'session.start', data: { sessionId: 's-1' } });
  const lines = [
    start,
    'noise',
    JSON.stringify({ type: 'assistant.message', data: { content: 'Hello' } }),
    JSON.stringify({
      type: 'tool.execution_start',
      data: { toolCallId: 't', toolName: 'bash', arguments: { command: 'ls' } },
    }),
    JSON.stringify({
      type: 'tool.execution_complete',
      data: { toolCallId: 't', success: true, result: 'a' },
    }),
    JSON.stringify({ type: 'assistant.usage', data: { inputTokens: 7, outputTokens: 3 } }),
    JSON.stringify({ type: 'assistant.usage', data: { inputTokens: 1, outputTokens: 1 } }),
  ];

  it('takes the id from the start event and adds the tokens of this process', () => {
    const parser = createCopilotParser();
    for (const line of lines) parser.push(line);
    expect(parser.outcome()).toMatchObject({
      sessionId: 's-1',
      usage: { inputTokens: 8, outputTokens: 4 },
      error: null,
    });
  });

  it('accepts the stored id after a resume and refuses another id or none', () => {
    const same = createCopilotParser('s-1');
    same.push(start);
    expect(same.outcome().conversationError).toBeNull();
    const other = createCopilotParser('s-2');
    other.push(start);
    expect(other.outcome().conversationError).toMatch(/not the stored conversation s-2/);
    expect(other.outcome().sessionId).toBeNull();
    expect(createCopilotParser('s-2').outcome().conversationError).toMatch(/no session start/);
  });

  it('reads the transcript with the corrupt line raw', () => {
    expect(copilotTranscript(lines).map((entry) => entry.kind)).toEqual([
      'raw',
      'text',
      'tool_call',
      'tool_result',
    ]);
  });
});
