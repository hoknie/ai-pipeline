import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OBSERVER_SPECIALIST,
  defaultRuntimes,
  findSpecialist,
  type Specialist,
} from '../../../src/feature/swarm-config/types/index.ts';
import type { StepInput } from '../../../src/feature/agents/types/index.ts';
import { createClaudeRuntime } from '../../../src/feature/agents/clients/claude/index.ts';
import { createOpencodeRuntime } from '../../../src/feature/agents/clients/opencode/index.ts';
import { missingSkills } from '../../../src/feature/agents/services/index.ts';
import {
  systemPrompt,
  userMessage,
  type LaunchContext,
} from '../../../src/feature/agents/types/index.ts';
import { runtimeFor } from './helpers.ts';
import { findExecutable } from '../../../src/platform/process/index.ts';
import { config } from '../runs/helpers.ts';

const fixtures = join(import.meta.dirname, '..', '..', 'fixtures');

function specialist(overrides: Partial<Specialist> = {}): Specialist {
  return { ...findSpecialist(config(), 'coder')!, allowCommands: ['npm test*'], ...overrides };
}

const input: StepInput = {
  prompt: 'Сделай: добавить логин',
  groupTitle: 'Логин',
  stepId: 'code',
  specialistName: 'Кодировщик',
  skills: [],
  previous: [
    { stepId: 'plan', specialist: 'plan', verdict: 'done', summary: 'план готов' },
    { stepId: 'review', specialist: 'reviewer', verdict: 'rejected', summary: 'есть ошибки' },
  ],
  feedback: 'нет тестов',
  humanAnswer: 'используй OAuth',
  decisions: [
    { stepId: 'plan', question: 'OAuth или пароль?', answer: 'используй OAuth', by: 'human' },
  ],
};

function context(overrides: Partial<LaunchContext> = {}): LaunchContext {
  return {
    specialist: specialist(),
    input,
    worktree: '/state/worktrees/x/run/login',
    attemptDirectory: '/state/logs/run/login/3',
    workerCommand: ['/usr/bin/node', '/aip/main.js', 'mcp', '--worker', 'token-1'],
    sessionId: '11111111-2222-3333-4444-555555555555',
    resumeSession: null,
    claudeEditMode: 'allowlist',
    claudeMcp: 'isolated',
    claudeSettings: 'isolated',
    ...overrides,
  };
}

function after(args: string[], flag: string): string | undefined {
  return args[args.indexOf(flag) + 1];
}

describe('message to the specialist', () => {
  it('lists previous steps, feedback and the answer after the prompt', () => {
    expect(userMessage(input)).toBe(
      [
        'Сделай: добавить логин',
        '## Previous steps\n- plan (plan, done): план готов\n- review (reviewer, rejected): есть ошибки',
        '## Accepted answers to questions in this group (do not ask them again)\n- plan: Q: OAuth или пароль? A: используй OAuth (by human)',
        '## Feedback to address\nнет тестов',
        '## Latest accepted answer\nиспользуй OAuth',
      ].join('\n\n'),
    );
  });

  it('adds the message of the person with its time after the answer', () => {
    const text = userMessage({ ...input, message: { text: 'смотри в src/auth', at: 0 } });
    expect(
      text.endsWith(
        '## Message from the person (sent 1970-01-01T00:00:00.000Z)\nсмотри в src/auth',
      ),
    ).toBe(true);
    expect(text.indexOf('## Latest accepted answer')).toBeLessThan(
      text.indexOf('## Message from the person'),
    );
    expect(userMessage(input)).not.toContain('Message from the person');
    expect(userMessage({ ...input, message: null })).not.toContain('Message from the person');
  });

  it('tells about human_only and, for a reviewed step, what to list in the summary', () => {
    const plain = systemPrompt(specialist(), input);
    expect(plain).toContain('human_only: true');
    expect(plain).not.toContain('a person reviews this step');
    const reviewed = systemPrompt(specialist(), { ...input, humanReview: true });
    expect(reviewed).toContain('a person reviews this step');
    expect(reviewed).toContain('summary');
  });

  it('shows the answer to a review under its own heading', () => {
    const text = userMessage({ ...input, reviewed: true, humanAnswer: 'Принято' });
    expect(text).toContain('## Answer of the person who reviewed this step\nПринято');
    expect(text).toContain('report "done"');
    expect(text).not.toContain('## Latest accepted answer');
  });

  it('requires swarm_report, names the worktree rule and the skills', () => {
    const text = systemPrompt(specialist({ skills: ['grill-me', 'opsx:propose'] }), input);
    expect(text).toContain('MUST call the tool `swarm_report`');
    expect(text).toContain('through `questions`');
    expect(text).toContain('`recommendation`');
    expect(text).toContain('Never run git push');
    expect(text).toContain('Use these skills for this step: grill-me, opsx:propose.');
    expect(text).toContain('run only the allowed shell commands');
    expect(text).toContain('Allowed shell commands');
    expect(text).toContain('one refused command refuses the whole call');
    expect(text).toContain('look for another way to do it within your permissions');
    expect(text).toContain('read them with the tool `swarm_run_show` instead of asking a person');
    expect(text).toContain('name the refused command in the question');
  });
});

describe('the allowed commands in the system prompt', () => {
  it('lists the allowed command patterns of an editing specialist', () => {
    const text = systemPrompt(
      specialist({ allowCommands: ['npm run check*', 'git status*'] }),
      input,
    );
    expect(text).toContain(
      'Allowed shell commands (`*` stands for the rest of the line): `npm run check*`, `git status*`.',
    );
  });

  it('says that no command is allowed when the list is empty, and lists nothing for read and full', () => {
    expect(systemPrompt(specialist({ allowCommands: [] }), input)).toContain(
      'No shell command is allowed.',
    );
    for (const permissions of ['read', 'full'] as const)
      expect(
        systemPrompt(specialist({ permissions, allowCommands: ['npm test'] }), input),
      ).not.toContain('Allowed shell commands');
  });
});

describe('skills lookup', () => {
  it('finds skills by directory, plugin-style names and command files', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-skills-'));
    mkdirSync(join(root, 'grill-me'), { recursive: true });
    writeFileSync(join(root, 'grill-me', 'SKILL.md'), '');
    mkdirSync(join(root, 'opsx'), { recursive: true });
    writeFileSync(join(root, 'opsx', 'propose.md'), '');
    expect(missingSkills(['grill-me', 'opsx:propose', 'unknown'], [root])).toEqual(['unknown']);
  });
});

describe('claude adapter', () => {
  const runtime = createClaudeRuntime('/bin/claude');

  it('allows only reading and the report tool for read', () => {
    const launch = runtime.buildLaunch(
      context({ specialist: specialist({ permissions: 'read' }) }),
    );
    expect(after(launch.args, '--permission-mode')).toBe('default');
    const allowed = launch.args.slice(
      launch.args.indexOf('--allowedTools') + 1,
      launch.args.indexOf('--disallowedTools'),
    );
    expect(allowed).toEqual([
      'Read',
      'Grep',
      'Glob',
      'mcp__aip__swarm_report',
      'mcp__aip__swarm_artifact',
      'mcp__aip__swarm_run_show',
      'mcp__aip__swarm_split',
    ]);
  });

  it('starts the MCP servers of the specialist next to aip and allows their tools', () => {
    const mcp = { graph: { command: '/bin/graph', args: ['--scout'], env: { A: 'b' } } };
    const between = (args: string[]) =>
      args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
    for (const claudeEditMode of ['allowlist', 'accept_edits', 'auto'] as const) {
      for (const permissions of ['read', 'edit'] as const) {
        const launch = runtime.buildLaunch(
          context({ claudeEditMode, specialist: specialist({ permissions, mcp }) }),
        );
        expect(between(launch.args)).toContain('mcp__graph');
        const config = JSON.parse(launch.files[0]?.content ?? '') as {
          mcpServers: Record<string, unknown>;
        };
        expect(config.mcpServers.graph).toEqual({ type: 'stdio', ...mcp.graph });
        expect(Object.keys(config.mcpServers).sort()).toEqual(['aip', 'graph']);
      }
    }
  });

  it('keeps --strict-mcp-config for a specialist with its own servers', () => {
    const mcp = { graph: { command: 'graph', args: [], env: {} } };
    const launch = runtime.buildLaunch(context({ specialist: specialist({ mcp }) }));
    expect(launch.args).toContain('--strict-mcp-config');
  });

  it('adds nothing for a specialist without its own servers', () => {
    const launch = runtime.buildLaunch(context());
    const config = JSON.parse(launch.files[0]?.content ?? '') as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(config.mcpServers)).toEqual(['aip']);
    expect(launch.args.filter((arg) => arg === 'mcp__graph')).toEqual([]);
  });

  it('allows the queue tool only to a specialist with queue', () => {
    const between = (args: string[]) =>
      args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
    for (const claudeEditMode of ['allowlist', 'accept_edits', 'auto'] as const) {
      for (const permissions of ['read', 'edit'] as const) {
        const allowed = between(
          runtime.buildLaunch(
            context({ claudeEditMode, specialist: specialist({ permissions, queue: true }) }),
          ).args,
        );
        expect(allowed).toContain('mcp__aip__swarm_queue_add');
        expect(allowed).toContain('mcp__aip__swarm_report');
      }
    }
    expect(between(runtime.buildLaunch(context()).args)).not.toContain('mcp__aip__swarm_queue_add');
  });

  it('allows the artifact tool to every specialist in every edit mode', () => {
    const between = (args: string[]) =>
      args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
    for (const claudeEditMode of ['allowlist', 'accept_edits', 'auto'] as const) {
      for (const permissions of ['read', 'edit'] as const) {
        const allowed = between(
          runtime.buildLaunch(context({ claudeEditMode, specialist: specialist({ permissions }) }))
            .args,
        );
        expect(allowed).toContain('mcp__aip__swarm_run_show');
        expect(allowed).toContain('mcp__aip__swarm_artifact');
        expect(allowed).not.toContain('mcp__aip__swarm_queue_add');
      }
    }
  });

  it('allows edits and only the listed commands for edit, never acceptEdits', () => {
    const launch = runtime.buildLaunch(context());
    expect(launch.args).toContain('Write');
    expect(launch.args).toContain('Bash(npm test*)');
    expect(launch.args).not.toContain('acceptEdits');
    expect(launch.args.slice(launch.args.indexOf('--disallowedTools') + 1)).toEqual([
      'Bash(git push:*)',
      'Bash(git checkout:*)',
      'Bash(git switch:*)',
    ]);
  });

  it('switches edit to acceptEdits when the project asks for it and still forbids push', () => {
    const launch = runtime.buildLaunch(context({ claudeEditMode: 'accept_edits' }));
    expect(after(launch.args, '--permission-mode')).toBe('acceptEdits');
    const allowed = launch.args.slice(
      launch.args.indexOf('--allowedTools') + 1,
      launch.args.indexOf('--disallowedTools'),
    );
    expect(allowed).toEqual([
      'Bash(npm test*)',
      'mcp__aip__swarm_report',
      'mcp__aip__swarm_artifact',
      'mcp__aip__swarm_run_show',
      'mcp__aip__swarm_split',
    ]);
    expect(launch.args).toContain('Bash(git push:*)');
    const read = runtime.buildLaunch(
      context({ claudeEditMode: 'accept_edits', specialist: specialist({ permissions: 'read' }) }),
    );
    expect(after(read.args, '--permission-mode')).toBe('default');
  });

  it('runs an editor in auto mode with the patterns as allow rules and push still forbidden', () => {
    const launch = runtime.buildLaunch(context({ claudeEditMode: 'auto' }));
    expect(after(launch.args, '--permission-mode')).toBe('auto');
    const allowed = launch.args.slice(
      launch.args.indexOf('--allowedTools') + 1,
      launch.args.indexOf('--disallowedTools'),
    );
    expect(allowed).toEqual([
      'Bash(npm test*)',
      'mcp__aip__swarm_report',
      'mcp__aip__swarm_artifact',
      'mcp__aip__swarm_run_show',
      'mcp__aip__swarm_split',
    ]);
    expect(launch.args).toEqual(
      expect.arrayContaining(['Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)']),
    );
    const read = runtime.buildLaunch(
      context({ claudeEditMode: 'auto', specialist: specialist({ permissions: 'read' }) }),
    );
    expect(after(read.args, '--permission-mode')).toBe('default');
    const full = runtime.buildLaunch(
      context({ claudeEditMode: 'auto', specialist: specialist({ permissions: 'full' }) }),
    );
    expect(full.args).toContain('--dangerously-skip-permissions');
    expect(full.args).not.toContain('--permission-mode');
  });

  it('keeps the user settings of Claude Code away unless they are inherited', () => {
    const isolated = runtime.buildLaunch(context()).args;
    expect(after(isolated, '--setting-sources')).toBe('project,local');
    expect(runtime.buildLaunch(context({ claudeSettings: 'inherit' })).args).not.toContain(
      '--setting-sources',
    );
  });

  it('loads only the aip MCP server when isolated and every server when inherited', () => {
    expect(runtime.buildLaunch(context()).args).toContain('--strict-mcp-config');
    expect(runtime.buildLaunch(context({ claudeMcp: 'inherit' })).args).not.toContain(
      '--strict-mcp-config',
    );
  });

  it('skips permissions for full but still forbids push', () => {
    const launch = runtime.buildLaunch(
      context({ specialist: specialist({ permissions: 'full' }) }),
    );
    expect(launch.args).toContain('--dangerously-skip-permissions');
    expect(launch.args.slice(launch.args.indexOf('--disallowedTools') + 1)).toEqual([
      'Bash(git push:*)',
    ]);
  });

  it('starts a fixed session, resumes it later and passes the model', () => {
    const fresh = runtime.buildLaunch(context());
    expect(after(fresh.args, '--session-id')).toBe('11111111-2222-3333-4444-555555555555');
    expect(after(fresh.args, '--model')).toBe('anthropic/sonnet');
    const resumed = runtime.buildLaunch(context({ resumeSession: 'previous' }));
    expect(after(resumed.args, '--resume')).toBe('previous');
    expect(resumed.args).not.toContain('--session-id');
    expect(resumed.sessionId).toBe('previous');
  });

  it('writes an MCP config that starts the worker server', () => {
    const launch = runtime.buildLaunch(context());
    expect(after(launch.args, '--mcp-config')).toBe('/state/logs/run/login/3/mcp.json');
    expect(JSON.parse(launch.files[0]!.content)).toEqual({
      mcpServers: {
        aip: {
          type: 'stdio',
          command: '/usr/bin/node',
          args: ['/aip/main.js', 'mcp', '--worker', 'token-1'],
        },
      },
    });
  });

  it('reads session, tokens and cost from recorded stream-json', () => {
    const parser = runtime.createParser();
    for (const line of readFileSync(join(fixtures, 'claude-stream.jsonl'), 'utf8').split('\n'))
      parser.push(line);
    parser.push('not json');
    expect(parser.outcome()).toEqual({
      sessionId: 'fa86c288-6f1b-44f7-889b-779235a84990',
      usage: { inputTokens: 2 + 23287, outputTokens: 4, costUsd: 0.00477342 },
      error: null,
      denials: [],
      usageLimit: null,
      networkError: null,
    });
  });

  describe('usage limit', () => {
    it('reads the exhausted limit and its reset from recorded stream-json', () => {
      const parser = runtime.createParser();
      for (const line of readFileSync(join(fixtures, 'claude-usage-limit.jsonl'), 'utf8').split(
        '\n',
      ))
        parser.push(line);
      expect(parser.outcome().usageLimit).toEqual({ resetsAt: 1793641800000 });
    });

    it('reads a limit without a reset time from the result', () => {
      const parser = runtime.createParser();
      parser.push(
        JSON.stringify({ type: 'result', is_error: true, api_error: 'usage_limit_reached' }),
      );
      expect(parser.outcome().usageLimit).toEqual({ resetsAt: null });
    });

    it('ignores a warning about the limit', () => {
      const parser = runtime.createParser();
      parser.push(
        JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: { status: 'allowed_warning', resetsAt: 1793641800 },
        }),
      );
      parser.push(
        JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [] } }),
      );
      parser.push(JSON.stringify({ type: 'result', is_error: false }));
      expect(parser.outcome().usageLimit).toBeNull();
    });
  });

  describe('network error', () => {
    const failed = (result: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type: 'result', is_error: true, result, ...extra });

    it('reads a connection error of the result', () => {
      const parser = runtime.createParser();
      parser.push(failed('API Error: Connection error.'));
      expect(parser.outcome().networkError).toBe('API Error: Connection error.');
      expect(parser.outcome().usageLimit).toBeNull();
    });

    it('knows the other texts of the list, whatever the case', () => {
      for (const text of [
        'read ECONNRESET',
        'connect ETIMEDOUT 1.2.3.4:443',
        'getaddrinfo ENOTFOUND api.anthropic.com',
        'getaddrinfo EAI_AGAIN x',
        'TypeError: fetch failed',
        'socket hang up',
        'request timed out',
        'unsupported_country_region_territory',
      ]) {
        const parser = runtime.createParser();
        parser.push(failed(text));
        expect(parser.outcome().networkError).toBe(text);
      }
    });

    it('cuts the text to 200 characters', () => {
      const parser = runtime.createParser();
      parser.push(failed(`Connection error ${'x'.repeat(500)}`));
      expect(parser.outcome().networkError).toHaveLength(200);
    });

    it('does not take other errors, or a result without is_error', () => {
      const parser = runtime.createParser();
      parser.push(failed('Invalid model name'));
      expect(parser.outcome().networkError).toBeNull();
      const fine = runtime.createParser();
      fine.push(JSON.stringify({ type: 'result', is_error: false, result: 'Connection error' }));
      expect(fine.outcome().networkError).toBeNull();
    });

    it('reports both a limit and a network error, the limit decides in the daemon', () => {
      const parser = runtime.createParser();
      parser.push(failed('Connection error', { api_error: 'usage_limit_reached' }));
      expect(parser.outcome().usageLimit).toEqual({ resetsAt: null });
      expect(parser.outcome().networkError).toBe('Connection error');
    });
  });

  describe('refused tool calls', () => {
    const toolUse = (id: string, name: string, input: unknown) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id, name, input }] },
      });
    const deniedEvent = (id: string) =>
      JSON.stringify({ type: 'system', subtype: 'permission_denied', tool_use_id: id });
    const result = (denials: unknown) =>
      JSON.stringify({ type: 'result', is_error: false, permission_denials: denials });

    it('counts a call refused by an event and in the result once', () => {
      const parser = runtime.createParser();
      parser.push(toolUse('t1', 'Bash', { command: 'claude plugin test x' }));
      parser.push(deniedEvent('t1'));
      parser.push(
        result([
          { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'claude plugin test x' } },
        ]),
      );
      expect(parser.outcome().denials).toEqual([{ tool: 'Bash', command: 'claude plugin test x' }]);
    });

    it('reads calls refused only in the result, and tools without a command', () => {
      const parser = runtime.createParser();
      parser.push(
        result([
          { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'python3 f.py' } },
          { tool_name: 'Write', tool_use_id: 't3', tool_input: { file_path: '/etc/hosts' } },
        ]),
      );
      expect(parser.outcome().denials).toEqual([
        { tool: 'Bash', command: 'python3 f.py' },
        { tool: 'Write', command: null },
      ]);
    });

    it('ignores a permission_denials of an unknown shape', () => {
      const parser = runtime.createParser();
      parser.push(result({ unexpected: true }));
      parser.push(result(['text', { tool: 'Bash' }]));
      expect(parser.outcome().denials).toEqual([]);
    });
  });
});

describe('opencode adapter', () => {
  const runtime = createOpencodeRuntime('/bin/opencode');

  it.each([
    { variant: 'company-deep' },
    { reasoningEffort: 'xhigh' as const },
    { variant: 'high', reasoningEffort: 'low' as const },
    {},
  ])('passes model options independently: %j', (options) => {
    const launch = runtime.buildLaunch(context({ specialist: specialist(options) }));
    const generated = JSON.parse(launch.files[0]!.content);
    const agent = generated.agent['aip-coder'];
    expect(launch.args).not.toContain('--variant');
    if ('reasoningEffort' in options)
      expect(agent.options).toEqual({ reasoningEffort: options.reasoningEffort });
    else expect(agent).not.toHaveProperty('options');
    expect(after(launch.args, '-m')).toBe(
      'variant' in options ? `anthropic/sonnet#${options.variant}` : 'anthropic/sonnet',
    );
    expect(Object.keys(generated)).toEqual(['$schema', 'mcp', 'agent']);
  });

  it('keeps options with sessions, permissions and extra runtime arguments, without a model', () => {
    const configured = createOpencodeRuntime('/bin/opencode', {
      args: ['--pure'],
      env: { KEEP: 'yes' },
    });
    const launch = configured.buildLaunch(
      context({
        resumeSession: 'ses_resume',
        specialist: specialist({
          model: null,
          variant: 'deep',
          reasoningEffort: 'high',
          permissions: 'full',
        }),
      }),
    );
    expect(launch.args.slice(0, 3)).toEqual(['--pure', 'run', '--standalone']);
    expect(launch.args).not.toContain('-m');
    expect(launch.args).not.toContain('--variant');
    expect(launch.args.join(' ')).not.toContain('deep');
    expect(after(launch.args, '-s')).toBe('ses_resume');
    expect(launch.args).toContain('--auto');
    const generated = JSON.parse(launch.files[0]!.content);
    expect(generated.agent['aip-coder']).toMatchObject({
      options: { reasoningEffort: 'high' },
      permission: { bash: { 'git push*': 'deny' } },
    });
    expect(generated.mcp.aip.command).toEqual(context().workerCommand);
    expect(launch.env.KEEP).toBe('yes');
  });

  it('adds the MCP servers of the specialist to the generated opencode.json', () => {
    const mcp = { graph: { command: '/bin/graph', args: ['--scout'], env: { A: 'b' } } };
    const generated = JSON.parse(
      runtime.buildLaunch(context({ specialist: specialist({ mcp }) })).files[0]!.content,
    );
    expect(generated.mcp.graph).toEqual({
      type: 'local',
      command: ['/bin/graph', '--scout'],
      environment: { A: 'b' },
      enabled: true,
    });
    expect(Object.keys(generated.mcp).sort()).toEqual(['aip', 'graph']);
    const plain = JSON.parse(runtime.buildLaunch(context()).files[0]!.content);
    expect(Object.keys(plain.mcp)).toEqual(['aip']);
  });

  it('keeps different efforts local to the agents of their attempts', () => {
    const high = runtime.buildLaunch(
      context({ specialist: specialist({ reasoningEffort: 'high' }) }),
    );
    const xhigh = runtime.buildLaunch(
      context({
        attemptDirectory: '/other-attempt',
        specialist: specialist({ slug: 'reviewer', reasoningEffort: 'xhigh' }),
      }),
    );
    expect(JSON.parse(high.files[0]!.content).agent['aip-coder'].options.reasoningEffort).toBe(
      'high',
    );
    expect(JSON.parse(xhigh.files[0]!.content).agent['aip-reviewer'].options.reasoningEffort).toBe(
      'xhigh',
    );
    expect(high.env.OPENCODE_CONFIG).not.toBe(xhigh.env.OPENCODE_CONFIG);
  });

  it('generates an agent with permissions and the worker MCP server', () => {
    const launch = runtime.buildLaunch(context());
    const generated = JSON.parse(launch.files[0]!.content);
    expect(launch.env).toEqual({ OPENCODE_CONFIG: '/state/logs/run/login/3/opencode.json' });
    expect(generated.mcp.aip).toEqual({
      type: 'local',
      command: ['/usr/bin/node', '/aip/main.js', 'mcp', '--worker', 'token-1'],
      enabled: true,
    });
    expect(generated.agent['aip-coder'].permission).toEqual({
      edit: 'allow',
      bash: {
        '*': 'deny',
        'npm test*': 'allow',
        'git push*': 'deny',
        'git checkout*': 'deny',
        'git switch*': 'deny',
      },
      webfetch: 'allow',
    });
  });

  it('runs standalone in the worktree, passes agent, model and session, --auto only for full', () => {
    const launch = runtime.buildLaunch(context({ resumeSession: 'ses_1' }));
    expect(launch.args.slice(0, 6)).toEqual([
      'run',
      '--standalone',
      '--format',
      'json',
      '--agent',
      'aip-coder',
    ]);
    expect(launch.args).not.toContain('--dir');
    expect(after(launch.args, '-m')).toBe('anthropic/sonnet');
    expect(after(launch.args, '-s')).toBe('ses_1');
    expect(launch.args).not.toContain('--auto');
    expect(
      runtime.buildLaunch(context({ specialist: specialist({ permissions: 'full' }) })).args,
    ).toContain('--auto');
    expect(
      runtime.buildLaunch(context({ specialist: specialist({ permissions: 'read' }) })).files[0]!
        .content,
    ).toContain('"bash": "deny"');
  });
});

describe('repair tools of the observer', () => {
  const repairNames = ['answer', 'retry', 'cancel'].map((name) => `mcp__aip__swarm_repair_${name}`);
  const allowedOf = (slug: string) => {
    const args = createClaudeRuntime('claude').buildLaunch(
      context({ specialist: specialist({ slug }) }),
    ).args;
    return args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  };

  it('allows them to the observer and not to an ordinary specialist', () => {
    expect(allowedOf(OBSERVER_SPECIALIST)).toEqual(expect.arrayContaining(repairNames));
    const ordinary = allowedOf('coder');
    for (const name of repairNames) expect(ordinary).not.toContain(name);
  });

  it('passes --repair of the worker command to opencode.json without tool rules', () => {
    const launch = createOpencodeRuntime('/bin/opencode').buildLaunch(
      context({
        specialist: specialist({ slug: OBSERVER_SPECIALIST }),
        workerCommand: ['/usr/bin/node', '/aip/main.js', 'mcp', '--worker', 'token-1', '--repair'],
      }),
    );
    const generated = JSON.parse(launch.files[0]!.content);
    expect(generated.mcp.aip.command.at(-1)).toBe('--repair');
    expect(launch.files[0]!.content).not.toContain('swarm_repair');
  });
});

describe('installation checks', () => {
  it('finds executables on PATH and reports missing ones', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-bin-'));
    writeFileSync(join(directory, 'opencode'), '#!/bin/sh\n');
    chmodSync(join(directory, 'opencode'), 0o755);
    expect(findExecutable('opencode', directory)).toBe(join(directory, 'opencode'));
    expect(findExecutable('opencode', '/nonexistent')).toBeNull();
  });

  it('lets tests replace the agent CLIs', () => {
    expect(runtimeFor('claude', { AIP_CLAUDE_BIN: '/fake/claude' }).executable).toBe(
      '/fake/claude',
    );
    expect(runtimeFor('opencode', {}).executable).toBe('opencode');
  });

  it('takes the command in the order: variable, settings, default name', () => {
    const settings = defaultRuntimes();
    settings.claude = { command: '/opt/claude', enabled: null, args: ['--debug'], env: { A: '1' } };
    expect(runtimeFor('claude', {}, settings).executable).toBe('/opt/claude');
    expect(runtimeFor('claude', { AIP_CLAUDE_BIN: '/fake/claude' }, settings).executable).toBe(
      '/fake/claude',
    );
    // arguments of the settings go with a command from the variable too
    const launch = runtimeFor('claude', { AIP_CLAUDE_BIN: '/fake/claude' }, settings).buildLaunch(
      context(),
    );
    expect(launch.command).toBe('/fake/claude');
    expect(launch.args[0]).toBe('--debug');
    expect(runtimeFor('opencode', {}, settings).executable).toBe('opencode');
  });
});

describe('extra arguments and variables of the settings', () => {
  const extra = { args: ['--add-dir', '/data'], env: { ENABLE_TOOL_SEARCH: 'true', KEEP: 'yes' } };

  it('go before the arguments of claude, and the variables of aip win', () => {
    const runtime = createClaudeRuntime('claude', extra);
    const launch = runtime.buildLaunch(context());
    expect(launch.args.slice(0, 4)).toEqual(['--add-dir', '/data', '-p', userMessage(input)]);
    expect(launch.args.filter((arg) => arg === '--disallowedTools')).toHaveLength(1);
    expect(launch.args.at(-1)).toMatch(/^Bash\(git /);
    expect(launch.env).toEqual({ ENABLE_TOOL_SEARCH: 'false', KEEP: 'yes' });
    const oneShot = runtime.buildOneShot({ prompt: 'q', model: 'haiku', directory: '/tmp/x' });
    expect(oneShot.args.slice(0, 3)).toEqual(['--add-dir', '/data', '-p']);
    expect(oneShot.env).toEqual({ ENABLE_TOOL_SEARCH: 'true', KEEP: 'yes' });
  });

  it('go before `run` of opencode, and OPENCODE_CONFIG wins', () => {
    const runtime = createOpencodeRuntime('npx', {
      args: ['-y', 'opencode-ai'],
      env: { OPENCODE_CONFIG: '/mine', KEEP: 'yes' },
    });
    const launch = runtime.buildLaunch(context());
    expect(launch.command).toBe('npx');
    expect(launch.args.slice(0, 6)).toEqual([
      '-y',
      'opencode-ai',
      'run',
      '--standalone',
      '--format',
      'json',
    ]);
    expect(launch.env.OPENCODE_CONFIG).toBe('/state/logs/run/login/3/opencode.json');
    expect(launch.env.KEEP).toBe('yes');
    const oneShot = runtime.buildOneShot({ prompt: 'q', model: 'm', directory: '/tmp/x' });
    expect(oneShot.args.slice(0, 3)).toEqual(['-y', 'opencode-ai', 'run']);
  });

  it('change nothing without them', () => {
    const plain = createClaudeRuntime('claude').buildLaunch(context());
    expect(createClaudeRuntime('claude', { args: [], env: {} }).buildLaunch(context())).toEqual(
      plain,
    );
    expect(plain.args[0]).toBe('-p');
  });
});

describe('claude tool set', () => {
  const tools = (overrides: Partial<Specialist> = {}, extra: Partial<LaunchContext> = {}) => {
    const launch = createClaudeRuntime('claude').buildLaunch(
      context({ specialist: specialist(overrides), ...extra }),
    );
    return { tools: after(launch.args, '--tools')?.split(','), launch };
  };

  it('gives a reader only the reading tools', () => {
    expect(tools({ permissions: 'read' }).tools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('gives an editor the editing tools and Bash, the same for full and accept_edits', () => {
    const editing = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'];
    expect(tools({ permissions: 'edit' }).tools).toEqual(editing);
    expect(tools({ permissions: 'full' }).tools).toEqual(editing);
    expect(tools({ permissions: 'edit' }, { claudeEditMode: 'accept_edits' }).tools).toEqual(
      editing,
    );
  });

  it('adds Skill for skills and the configured tools once', () => {
    expect(
      tools({ permissions: 'read', skills: ['grill-me'], tools: ['WebFetch', 'Read'] }).tools,
    ).toEqual(['Read', 'Grep', 'Glob', 'Skill', 'WebFetch']);
  });

  it('loads the report tool without a tool search and keeps the permissions', () => {
    const { launch } = tools({ permissions: 'edit' });
    expect(launch.env.ENABLE_TOOL_SEARCH).toBe('false');
    expect(launch.args).toContain('mcp__aip__swarm_report');
    expect(launch.args).toContain('Bash(npm test*)');
  });
});

describe('opencode run --format json output', () => {
  const runtime = createOpencodeRuntime('/bin/opencode');
  const recorded = readFileSync(
    join(import.meta.dirname, '..', '..', 'fixtures', 'opencode-run.jsonl'),
    'utf8',
  ).split('\n');

  it('reads the session and sums the tokens of every step of a recorded run', () => {
    const parser = runtime.createParser();
    for (const line of recorded) parser.push(line);
    expect(parser.outcome()).toEqual({
      sessionId: 'ses_ses1',
      usage: { inputTokens: 19026 + 19090, outputTokens: 25 + 20 + 3 + 1, costUsd: 0 },
      error: null,
      denials: [],
    });
  });

  it('sums the cost and reasoning tokens of steps and ignores cache reads', () => {
    const parser = runtime.createParser();
    const step = (cost: number, reasoning = 0, cacheRead = 0, cacheWrite = 0) =>
      JSON.stringify({
        type: 'step_finish',
        sessionID: 'ses_1',
        part: {
          type: 'step-finish',
          tokens: {
            input: 10,
            output: 5,
            reasoning,
            cache: { read: cacheRead, write: cacheWrite },
          },
          cost,
        },
      });
    parser.push(step(0.25, 20, 500, 4));
    parser.push(step(0.5, 30, 800, 6));
    expect(parser.outcome().usage).toEqual({
      inputTokens: 30,
      outputTokens: 60,
      costUsd: 0.75,
    });
  });

  it('reports the message of an error event, not its response headers', () => {
    const parser = runtime.createParser();
    parser.push(
      JSON.stringify({
        type: 'error',
        sessionID: 'ses_1',
        error: {
          name: 'APIError',
          data: {
            message: 'Prompt tokens limit exceeded: 19662 > 18740',
            statusCode: 402,
            responseHeaders: { 'x-filler': 'x'.repeat(600) },
          },
        },
      }),
    );
    expect(parser.outcome().error).toBe('Prompt tokens limit exceeded: 19662 > 18740');
  });
});

describe('live usage', () => {
  const assistant = (
    id: string | undefined,
    input: number,
    output: number,
    cacheRead = 0,
    cacheCreation = 0,
  ) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        ...(id === undefined ? {} : { id }),
        role: 'assistant',
        content: [{ type: 'text', text: 'x' }],
        usage: {
          input_tokens: input,
          cache_creation_input_tokens: cacheCreation,
          cache_read_input_tokens: cacheRead,
          output_tokens: output,
        },
      },
    });
  const result = JSON.stringify({
    type: 'result',
    is_error: false,
    session_id: 's1',
    total_cost_usd: 0.5,
    usage: { input_tokens: 900, output_tokens: 90 },
  });

  it('has no usage before the first message', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    expect(parser.usage()).toBeNull();
    parser.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
    expect(parser.usage()).toBeNull();
  });

  it('sums the messages of the assistant without a cost and ignores cache reads', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(assistant('m1', 100, 10, 50, 5));
    expect(parser.usage()).toEqual({ inputTokens: 105, outputTokens: 10, costUsd: null });
    parser.push(assistant('m2', 200, 20));
    expect(parser.usage()).toEqual({ inputTokens: 305, outputTokens: 30, costUsd: null });
  });

  it('counts a message of several events once, by the last event', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(assistant('m1', 100, 1));
    parser.push(assistant('m1', 100, 5));
    parser.push(assistant('m1', 100, 12));
    expect(parser.usage()).toEqual({ inputTokens: 100, outputTokens: 12, costUsd: null });
  });

  it('adds messages without an id each time', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(assistant(undefined, 10, 1));
    parser.push(assistant(undefined, 10, 1));
    expect(parser.usage()).toEqual({ inputTokens: 20, outputTokens: 2, costUsd: null });
  });

  it('lets the result override the sum and the cost, and later messages change nothing', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(assistant('m1', 100, 10));
    parser.push(result);
    expect(parser.usage()).toEqual({ inputTokens: 900, outputTokens: 90, costUsd: 0.5 });
    parser.push(assistant('m2', 5000, 500));
    expect(parser.usage()).toEqual({ inputTokens: 900, outputTokens: 90, costUsd: 0.5 });
    expect(parser.outcome().usage).toEqual(parser.usage());
  });

  it('keeps the sum as the usage of an outcome when the result never came', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(assistant('m1', 100, 10));
    parser.push(assistant('m2', 200, 20));
    expect(parser.outcome().usage).toEqual({ inputTokens: 300, outputTokens: 30, costUsd: null });
  });

  it('ignores assistant events without usage', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(
      JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text' }] } }),
    );
    expect(parser.usage()).toBeNull();
  });

  it('gives the usage of opencode after every finished step', () => {
    const parser = createOpencodeRuntime('/bin/opencode').createParser();
    expect(parser.usage()).toBeNull();
    const step = (input: number, output: number) =>
      JSON.stringify({
        type: 'step_finish',
        sessionID: 'ses_1',
        part: { type: 'step-finish', tokens: { input, output }, cost: 0.25 },
      });
    parser.push(step(10, 1));
    expect(parser.usage()).toEqual({ inputTokens: 10, outputTokens: 1, costUsd: 0.25 });
    parser.push(step(20, 2));
    expect(parser.usage()).toEqual({ inputTokens: 30, outputTokens: 3, costUsd: 0.5 });
    expect(parser.outcome().usage).toEqual(parser.usage());
  });
});
