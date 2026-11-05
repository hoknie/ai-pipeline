import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultRuntimes, findSpecialist, type Specialist } from '../../src/config/index.ts';
import type { StepInput } from '../../src/core/index.ts';
import {
  createClaudeRuntime,
  createOpencodeRuntime,
  findExecutable,
  missingSkills,
  runtimeFor,
  systemPrompt,
  userMessage,
  type LaunchContext,
} from '../../src/runtime/index.ts';
import { config } from '../core/helpers.ts';

const fixtures = join(import.meta.dirname, '..', 'fixtures');

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
    expect(text).toContain('look for another way to do it within your permissions');
    expect(text).toContain('name the refused command in the question');
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
      'mcp__aip__swarm_split',
    ]);
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
      usage: { inputTokens: 2 + 23287 + 11382, outputTokens: 4, costUsd: 0.00477342 },
      error: null,
      denials: [],
      usageLimit: null,
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

  it('passes directory, agent, model and session and enables --auto only for full', () => {
    const launch = runtime.buildLaunch(context({ resumeSession: 'ses_1' }));
    expect(launch.args.slice(0, 7)).toEqual([
      'run',
      '--format',
      'json',
      '--dir',
      '/state/worktrees/x/run/login',
      '--agent',
      'aip-coder',
    ]);
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
    settings.claude = { command: '/opt/claude', args: ['--debug'], env: { A: '1' } };
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
    expect(launch.args.slice(0, 5)).toEqual(['-y', 'opencode-ai', 'run', '--format', 'json']);
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
    join(import.meta.dirname, '..', 'fixtures', 'opencode-run.jsonl'),
    'utf8',
  ).split('\n');

  it('reads the session and sums the tokens of every step of a recorded run', () => {
    const parser = runtime.createParser();
    for (const line of recorded) parser.push(line);
    expect(parser.outcome()).toEqual({
      sessionId: 'ses_ses1',
      usage: { inputTokens: 19026 + 19090, outputTokens: 25 + 3, costUsd: 0 },
      error: null,
      denials: [],
    });
  });

  it('sums the cost of steps', () => {
    const parser = runtime.createParser();
    const step = (cost: number) =>
      JSON.stringify({
        type: 'step_finish',
        sessionID: 'ses_1',
        part: { type: 'step-finish', tokens: { input: 1, output: 1 }, cost },
      });
    parser.push(step(0.25));
    parser.push(step(0.5));
    expect(parser.outcome().usage?.costUsd).toBeCloseTo(0.75);
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

  it('sums the messages of the assistant without a cost', () => {
    const parser = createClaudeRuntime('/bin/claude').createParser();
    parser.push(assistant('m1', 100, 10, 50, 5));
    expect(parser.usage()).toEqual({ inputTokens: 155, outputTokens: 10, costUsd: null });
    parser.push(assistant('m2', 200, 20));
    expect(parser.usage()).toEqual({ inputTokens: 355, outputTokens: 30, costUsd: null });
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
