import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface Action {
  verdict?: 'done' | 'rejected' | 'needs_human';
  summary?: string;
  feedback?: string;
  questions?: { text: string; options?: string[]; recommendation?: string }[];
  write?: Record<string, string>;
  /** Paths whose contents (or null) are appended to reads.jsonl in the state directory. */
  read?: string[];
  outside?: Record<string, string>;
  split?: { title: string; task: string }[];
  /**
   * Calls swarm_queue_add with these arguments; its text result goes to queued.jsonl. `$last` in
   * `after` stands for the id on the last line of queued.jsonl.
   */
  queue?: Record<string, unknown>;
  /**
   * Calls swarm_queue_add once per entry; `$prev` in `after` stands for the id of the item the
   * previous call returned. The results go to queued.jsonl.
   */
  queueChain?: Record<string, unknown>[];
  delayMs?: number;
  /** Waits until this file exists, after `delayMs`: the test decides when the agent goes on. */
  waitFor?: string;
  noReport?: boolean;
  hang?: boolean;
  child?: boolean;
  exitCode?: number;
  /** Refused shell commands, reported the way Claude Code does: as events and in the result. */
  denied?: string[];
  /**
   * The fake claude stops without a report the way Claude Code does when the usage limit ran out;
   * `resetsAt` in seconds of the epoch, absent: no reset time.
   */
  usageLimit?: { resetsAt?: number };
  /**
   * Usage the agent reports as it works, before `delayMs`: `claude` prints `assistant` events with
   * `message.usage` (the same `id` repeats a message), `opencode` prints `step-finish` events.
   * The final `result` carries the sum, unless `noResult` is set.
   */
  usage?: { id?: string; input: number; output: number; cacheRead?: number }[];
  /** Pause between the calls of `usage`. */
  usageGapMs?: number;
  noResult?: boolean;
}

const [mode, ...args] = process.argv.slice(2);

if (args[0] === '--version') {
  console.log(`fake ${mode} 0.0.0`);
  process.exit(0);
}

// Host management of the fake claude: `mcp` and `plugin` subcommands keep their state in the JSON
// file AIP_FAKE_HOST_STATE. AIP_FAKE_HOST_FAIL is a comma-separated list of argument prefixes
// (`mcp add`, `plugin`) that fail; a failing `plugin` answers like a Claude Code without it.
if (mode === 'claude' && (args[0] === 'mcp' || args[0] === 'plugin')) {
  const file = process.env.AIP_FAKE_HOST_STATE!;
  const joined = args.join(' ');
  const failing = (process.env.AIP_FAKE_HOST_FAIL ?? '').split(',').filter(Boolean);
  if (failing.some((prefix) => joined.startsWith(prefix))) {
    console.error(
      args[0] === 'plugin' && failing.includes('plugin')
        ? `error: unknown command '${args[0]}'`
        : `error: ${joined} failed`,
    );
    process.exit(1);
  }
  const hostState: {
    mcp: Record<string, { command: string; args: string[] }>;
    marketplaces: string[];
    plugins: string[];
  } = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { mcp: {}, marketplaces: [], plugins: [] };
  const save = (): void => writeFileSync(file, JSON.stringify(hostState));
  const [, sub, third, fourth] = args;
  if (args[0] === 'mcp' && sub === 'get') {
    const server = hostState.mcp[third ?? ''];
    if (!server) {
      console.error(`No MCP server found with name: ${third}`);
      process.exit(1);
    }
    console.log(
      `${third}:\n  Scope: User config\n  Type: stdio\n  Command: ${server.command}\n  Args: ${server.args.join(' ')}`,
    );
  } else if (args[0] === 'mcp' && sub === 'add') {
    const rest = args
      .slice(2)
      .filter((arg, index, all) => arg !== '--scope' && all[index - 1] !== '--scope');
    const separator = rest.indexOf('--');
    hostState.mcp[rest[0]!] = { command: rest[separator + 1]!, args: rest.slice(separator + 2) };
    save();
  } else if (args[0] === 'mcp' && sub === 'remove') {
    delete hostState.mcp[args.at(-1)!];
    save();
  } else if (args[0] === 'plugin' && sub === 'list') {
    for (const plugin of hostState.plugins) console.log(`  ${plugin}`);
  } else if (args[0] === 'plugin' && sub === 'marketplace' && third === 'add') {
    hostState.marketplaces.push(fourth!);
    save();
  } else if (args[0] === 'plugin' && (sub === 'update' || sub === 'marketplace')) {
    // `plugin update` and `plugin marketplace update`: nothing to change in the fake state.
  } else if (args[0] === 'plugin' && sub === 'install') {
    hostState.plugins.push(third!);
    save();
  } else {
    console.error(`error: unsupported fake command ${joined}`);
    process.exit(2);
  }
  process.exit(0);
}

// A one-shot question (naming a run): answers with `script.naming`, or fails when it is not set.
if (args.includes('--no-session-persistence') || args.includes('aip-oneshot')) {
  const state = process.env.AIP_FAKE_STATE;
  const script = process.env.AIP_FAKE_SCRIPT
    ? JSON.parse(readFileSync(process.env.AIP_FAKE_SCRIPT, 'utf8'))
    : {};
  const naming = script.naming as { answer?: string; delayMs?: number } | undefined;
  if (state) {
    mkdirSync(state, { recursive: true });
    appendFileSync(join(state, 'oneshots.jsonl'), `${JSON.stringify({ mode, args })}\n`);
  }
  if (!naming) process.exit(1);
  if (naming.delayMs) await new Promise((resolve) => setTimeout(resolve, naming.delayMs));
  const answer = naming.answer ?? '';
  if (mode === 'claude') {
    console.log(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0.002,
        usage: {
          input_tokens: 30,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 10,
        },
      }),
    );
  } else {
    console.log(JSON.stringify({ type: 'text', part: { type: 'text', text: answer } }));
  }
  process.exit(0);
}

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function workerCommand(): {
  command: string;
  args: string[];
  prompt: string;
  message: string;
  cwd: string;
} {
  if (mode === 'claude') {
    const config = JSON.parse(readFileSync(option('--mcp-config')!, 'utf8'));
    const server = config.mcpServers.aip;
    return {
      command: server.command,
      args: server.args,
      prompt: option('--append-system-prompt') ?? '',
      message: option('-p') ?? '',
      cwd: process.cwd(),
    };
  }
  const config = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG!, 'utf8'));
  const [command, ...rest] = config.mcp.aip.command as string[];
  const agent = Object.values(config.agent)[0] as { prompt: string };
  return {
    command: command!,
    args: rest,
    prompt: agent.prompt,
    message: args.at(-1) ?? '',
    cwd: option('--dir')!,
  };
}

const state = process.env.AIP_FAKE_STATE!;
const worker = workerCommand();
const step = /Step: "([^"]+)"/.exec(worker.prompt)?.[1] ?? 'unknown';
const group = /Group: "([^"]+)"/.exec(worker.prompt)?.[1] ?? 'unknown';
mkdirSync(state, { recursive: true });
appendFileSync(
  join(state, 'calls.jsonl'),
  `${JSON.stringify({ mode, step, group, args, cwd: worker.cwd })}\n`,
);
const counterPath = join(state, `count-${group}-${step}`.replace(/[^\w.-]/g, '_'));
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
writeFileSync(counterPath, String(count + 1));
const script = process.env.AIP_FAKE_SCRIPT
  ? JSON.parse(readFileSync(process.env.AIP_FAKE_SCRIPT, 'utf8'))
  : {};
const actions: Action[] = script[step] ?? [];
const action: Action = actions[Math.min(count, actions.length - 1)] ?? {};

if (action.read) {
  const contents = Object.fromEntries(
    action.read.map((path) => {
      const file = join(worker.cwd, path);
      return [path, existsSync(file) ? readFileSync(file, 'utf8') : null];
    }),
  );
  appendFileSync(join(state, 'reads.jsonl'), `${JSON.stringify({ step, group, contents })}\n`);
}
for (const [path, content] of Object.entries(action.write ?? {})) {
  mkdirSync(dirname(join(worker.cwd, path)), { recursive: true });
  writeFileSync(join(worker.cwd, path), content);
}
for (const [path, content] of Object.entries(action.outside ?? {})) writeFileSync(path, content);
if (action.child) {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  appendFileSync(join(state, 'children'), `${child.pid}\n`);
}
const liveUsage = action.usage ?? [];
for (const [index, call] of liveUsage.entries()) {
  if (index > 0 && action.usageGapMs) {
    await new Promise((resolve) => setTimeout(resolve, action.usageGapMs));
  }
  if (mode === 'claude') {
    console.log(
      JSON.stringify({
        type: 'assistant',
        message: {
          id: call.id ?? `msg_live_${index}`,
          role: 'assistant',
          content: [{ type: 'text', text: 'working' }],
          usage: {
            input_tokens: call.input,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: call.cacheRead ?? 0,
            output_tokens: call.output,
          },
        },
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        type: 'step_finish',
        part: {
          type: 'step-finish',
          tokens: {
            input: call.input,
            output: call.output,
            cache: { read: call.cacheRead ?? 0, write: 0 },
          },
        },
      }),
    );
  }
}
if (action.delayMs) await new Promise((resolve) => setTimeout(resolve, action.delayMs));
while (action.waitFor && !existsSync(action.waitFor))
  await new Promise((resolve) => setTimeout(resolve, 20));
if (action.hang) await new Promise(() => setInterval(() => undefined, 1000));

const session =
  mode === 'claude' ? (option('--session-id') ?? option('--resume') ?? 'none') : 'ses_fake';
if (action.usageLimit && mode === 'claude') {
  const info = {
    status: 'rejected',
    rateLimitType: 'five_hour',
    ...(action.usageLimit.resetsAt === undefined ? {} : { resetsAt: action.usageLimit.resetsAt }),
  };
  const text = "You've hit your 5-hour limit";
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: session }));
  console.log(
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
      session_id: session,
      error: 'rate_limit',
      api_error_status: 429,
      api_error: 'usage_limit_reached',
      api_error_params: { rate_limit_info: info },
    }),
  );
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      api_error: 'usage_limit_reached',
      result: text,
      session_id: session,
      total_cost_usd: 0,
    }),
  );
  process.exit(1);
}

if (!action.noReport) {
  const client = new Client({ name: 'fake-agent', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: worker.command, args: worker.args, stderr: 'inherit' }),
  );
  if (action.split)
    await client.callTool({ name: 'swarm_split', arguments: { groups: action.split } });
  if (action.queue) {
    const lastQueued = (() => {
      try {
        const lines = readFileSync(join(state, 'queued.jsonl'), 'utf8').trim().split('\n');
        return /Queued (\S+) for/.exec(lines.at(-1) ?? '')?.[1] ?? '';
      } catch {
        return '';
      }
    })();
    const queueArguments = Array.isArray(action.queue.after)
      ? {
          ...action.queue,
          after: action.queue.after.map((id) => (id === '$last' ? lastQueued : id)),
        }
      : action.queue;
    const queued = await client.callTool({ name: 'swarm_queue_add', arguments: queueArguments });
    appendFileSync(join(state, 'queued.jsonl'), `${JSON.stringify({ step, group, queued })}\n`);
  }
  if (action.queueChain) {
    let previous = '';
    for (const entry of action.queueChain) {
      const after = Array.isArray(entry.after)
        ? entry.after.map((id) => (id === '$prev' ? previous : id))
        : undefined;
      const queued = (await client.callTool({
        name: 'swarm_queue_add',
        arguments: { ...entry, ...(after ? { after } : {}) },
      })) as { content?: { text?: string }[] };
      previous = /Queued (\S+)/.exec(queued.content?.[0]?.text ?? '')?.[1] ?? previous;
      appendFileSync(join(state, 'queued.jsonl'), `${JSON.stringify({ step, group, queued })}\n`);
    }
  }
  const verdict = action.verdict ?? 'done';
  const result = await client.callTool({
    name: 'swarm_report',
    arguments: {
      verdict,
      summary: action.summary ?? `${step} ${verdict}`,
      ...(action.feedback || (verdict !== 'done' && !action.questions)
        ? { feedback: action.feedback ?? 'remarks' }
        : {}),
      ...(action.questions ? { questions: action.questions } : {}),
    },
  });
  appendFileSync(join(state, 'reports.jsonl'), `${JSON.stringify({ step, group, result })}\n`);
  await client.close();
}

if (mode === 'claude') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: session }));
  const denied = (action.denied ?? []).map((command, index) => ({
    tool_name: 'Bash',
    tool_use_id: `toolu_denied_${index}`,
    tool_input: { command },
  }));
  for (const denial of denied) {
    console.log(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: denial.tool_use_id, name: 'Bash', input: denial.tool_input },
          ],
        },
      }),
    );
    console.log(
      JSON.stringify({
        type: 'system',
        subtype: 'permission_denied',
        tool_use_id: denial.tool_use_id,
        message: 'This command requires approval',
      }),
    );
  }
  // The same message id repeats one message: the last call of an id counts.
  const finalCalls = new Map(
    liveUsage.map((call, index) => [call.id ?? `msg_live_${index}`, call]),
  );
  const sum = (pick: (call: (typeof liveUsage)[number]) => number): number =>
    [...finalCalls.values()].reduce((total, call) => total + pick(call), 0);
  if (!action.noResult) {
    console.log(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: session,
        total_cost_usd: 0.01,
        permission_denials: denied,
        usage:
          liveUsage.length > 0
            ? {
                input_tokens: sum((call) => call.input),
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: sum((call) => call.cacheRead ?? 0),
                output_tokens: sum((call) => call.output),
              }
            : {
                input_tokens: 100,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: 20,
              },
      }),
    );
  }
} else {
  const message = 'msg_fake';
  const timestamp = Date.now();
  console.log(
    JSON.stringify({
      type: 'step_start',
      timestamp,
      sessionID: session,
      part: { id: 'prt_fake1', messageID: message, sessionID: session, type: 'step-start' },
    }),
  );
  console.log(
    JSON.stringify({
      type: 'text',
      timestamp,
      sessionID: session,
      part: {
        id: 'prt_fake2',
        messageID: message,
        sessionID: session,
        type: 'text',
        text: 'done',
        time: { start: timestamp, end: timestamp },
      },
    }),
  );
  console.log(
    JSON.stringify({
      type: 'step_finish',
      timestamp,
      sessionID: session,
      part: {
        id: 'prt_fake3',
        reason: 'stop',
        messageID: message,
        sessionID: session,
        type: 'step-finish',
        tokens: { total: 60, input: 50, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.002,
      },
    }),
  );
}
process.exit(action.exitCode ?? 0);
