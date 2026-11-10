import { describe, expect, it } from 'vitest';

import { createClaudeRuntime } from '../../../src/feature/agents/clients/claude/index.ts';
import { parseNaming } from '../../../src/feature/agents/clients/naming/index.ts';
import { createOpencodeRuntime } from '../../../src/feature/agents/clients/opencode/index.ts';
import { answerText, namingPrompt } from '../../../src/feature/agents/types/index.ts';

describe('one-shot calls', () => {
  it('asks claude without tools or MCP servers', () => {
    const launch = createClaudeRuntime('claude').buildOneShot({
      prompt: 'Q',
      model: 'haiku',
      directory: '/tmp/x',
    });
    expect(launch.args.slice(0, 2)).toEqual(['-p', 'Q']);
    expect(launch.args).toEqual(
      expect.arrayContaining(['--model', 'haiku', '--strict-mcp-config']),
    );
    expect(launch.args[launch.args.indexOf('--setting-sources') + 1]).toBe('project,local');
    expect(launch.args[launch.args.indexOf('--tools') + 1]).toBe('');
    expect(launch.args[launch.args.indexOf('--mcp-config') + 1]).toBe('/tmp/x/mcp.json');
    expect(JSON.parse(launch.files[0]?.content ?? '')).toEqual({ mcpServers: {} });
  });

  it('asks opencode with an agent that may not edit, run commands or fetch', () => {
    const launch = createOpencodeRuntime('opencode').buildOneShot({
      prompt: 'Q',
      model: 'anthropic/haiku',
      directory: '/tmp/x',
    });
    expect(launch.args).toEqual([
      'run',
      '--standalone',
      '--format',
      'json',
      '--agent',
      'aip-oneshot',
      '-m',
      'anthropic/haiku',
      'Q',
    ]);
    const config = JSON.parse(launch.files[0]?.content ?? '');
    expect(config.agent['aip-oneshot'].permission).toEqual({
      edit: 'deny',
      bash: 'deny',
      webfetch: 'deny',
    });
    expect(launch.env.OPENCODE_CONFIG).toBe('/tmp/x/opencode.json');
  });
});

describe('naming answers', () => {
  it('builds a prompt that carries the task', () => {
    const prompt = namingPrompt('Добавить флаг --json');
    expect(prompt).toContain('Добавить флаг --json');
    expect(prompt).toContain('kebab-case');
  });

  it('reads the first JSON object and checks lengths and the name pattern', () => {
    expect(parseNaming('Вот: {"title": "Флаг --json", "name": "add-json-flag"} готово')).toEqual({
      title: 'Флаг --json',
      name: 'add-json-flag',
    });
    expect(parseNaming('{"title": "x", "name": "Not Kebab"}')).toEqual({
      title: 'x',
      name: 'not-kebab',
    });
    expect(parseNaming('{"title": " ", "name": "a"}')).toBeNull();
    expect(parseNaming('{"title": "x", "name": "!!!"}')).toBeNull();
    expect(parseNaming('no json')).toBeNull();
    expect(parseNaming('{broken')).toBeNull();
  });

  it('cuts a long title at a word and a long name at a hyphen', () => {
    const answer = JSON.stringify({
      title: 'aip clean без аргументов: список завершённых ранов и подсказка команды',
      name: 'clean-list-finished-runs-with-a-hint-of-the-command',
    });
    const naming = parseNaming(answer);
    expect(naming?.title).toBe('aip clean без аргументов: список завершённых ранов и…');
    expect(naming?.title.length).toBeLessThanOrEqual(60);
    expect(naming?.name).toBe('clean-list-finished-runs-with-a-hint-of');
    expect(naming?.name.length).toBeLessThanOrEqual(40);
  });

  it('takes the answer from the result, or from the printed text', () => {
    expect(
      answerText([
        { kind: 'text', text: 'draft' },
        {
          kind: 'result',
          text: 'final',
          error: false,
          verdict: null,
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        },
      ]),
    ).toBe('final');
    expect(
      answerText([
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });
});
