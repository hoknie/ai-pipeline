import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

interface Action {
  verdict?: 'done' | 'rejected' | 'needs_human';
  summary?: string;
  feedback?: string;
  questions?: { text: string; options?: string[]; recommendation?: string }[];
  /** The questions are for a person only (`human_only` of the report). */
  humanOnly?: boolean;
  write?: Record<string, string>;
  /** Symlinks created in the worktree: link path → target. */
  link?: Record<string, string>;
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
  /**
   * Reports through the real worker MCP server (`aip mcp --worker`) instead of sending the same
   * requests straight to the daemon socket, which is the default: starting a node process for
   * every attempt costs far more than the rest of an attempt.
   */
  realWorker?: boolean;
  /**
   * Tool calls made before `split`, `queue` and the report; each answer goes to tools.jsonl as
   * `{ step, group, name, result }`. Lets a test check the text and the errors of a tool.
   */
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  delayMs?: number;
  /** Waits until this file exists, after `delayMs`: the test decides when the agent goes on. */
  waitFor?: string;
  noReport?: boolean;
  hang?: boolean;
  child?: boolean;
  /** A child that ignores SIGTERM, so it outlives the agent's process group signal. */
  stubbornChild?: boolean;
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

/**
 * A minimal MCP client over stdio (newline-delimited JSON-RPC): enough to call the tools of the
 * worker server. The SDK client costs a noticeable import on every start of the fake agent.
 */
async function connectWorker(command: string, commandArgs: string[]) {
  const child = spawn(command, commandArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let buffer = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      const id = message.id as number | undefined;
      if (id !== undefined && pending.has(id)) {
        pending.get(id)!(message);
        pending.delete(id);
      }
    }
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const send = (message: Record<string, unknown>) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const call = (method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) =>
        message.error
          ? reject(new Error((message.error as { message: string }).message))
          : resolve(message.result),
      );
      send({ id, method, params });
    });
  child.once('exit', () => {
    for (const settle of pending.values()) settle({ error: { message: 'worker exited' } });
  });
  await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fake-agent', version: '0' },
  });
  send({ method: 'notifications/initialized' });
  return {
    callTool: (request: { name: string; arguments: Record<string, unknown> }) =>
      call('tools/call', request),
    async close() {
      child.stdin.end();
      await closed;
    },
  };
}

/** One request to the daemon socket: the same line protocol as `src/presentation/ipc/client/client.ts`. */
function ipc(socket: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let buffer = '';
    connection.setEncoding('utf8');
    connection.once('error', reject);
    connection.once('connect', () =>
      connection.write(`${JSON.stringify({ id: 1, method, params })}\n`),
    );
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      connection.end();
      const response = JSON.parse(buffer.slice(0, end)) as {
        ok: boolean;
        result?: unknown;
        error?: string;
      };
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    });
  });
}

const toolText = (value: string, isError = false) => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {}),
});

/** The tools of the worker server, answered without a worker process; same texts and arguments. */
function connectDirect(workerArgs: string[]) {
  const option = (name: string) => workerArgs[workerArgs.indexOf(name) + 1]!;
  const token = option('--worker');
  const socket = option('--socket');
  return {
    async callTool(request: { name: string; arguments: Record<string, unknown> }) {
      const input = request.arguments;
      try {
        if (request.name === 'swarm_report') {
          await ipc(socket, 'report', {
            token,
            verdict: input.verdict,
            summary: input.summary,
            feedback: input.feedback ?? null,
            questions: input.questions ?? null,
            ...(input.human_only === true ? { human_only: true } : {}),
          });
          return toolText(`Recorded verdict ${String(input.verdict)}. You can stop now.`);
        }
        if (request.name === 'swarm_artifact') {
          if ((input.content === undefined) === (input.path === undefined))
            throw new Error('pass either content or path');
          const result = (await ipc(socket, 'artifact_publish', {
            token,
            fileName: input.file_name,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.path !== undefined ? { path: input.path } : {}),
          })) as { id?: string };
          return toolText(
            `Recorded artifact ${result.id ?? ''} (${String(input.file_name)}). Call swarm_report when you are done.`,
          );
        }
        if (request.name.startsWith('swarm_repair_')) {
          // The tools of an observer (`--repair`): one request, the daemon keeps the limits.
          await ipc(socket, 'repair_action', {
            token,
            action: request.name.slice('swarm_repair_'.length),
            ...(input.group !== undefined ? { group: input.group } : {}),
            ...(input.answer !== undefined ? { answer: input.answer } : {}),
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
            ...(input.refresh_config !== undefined ? { refreshConfig: input.refresh_config } : {}),
          });
          return toolText(`Done: ${request.name}.`);
        }
        if (request.name === 'swarm_split') {
          const groups = input.groups as unknown[];
          await ipc(socket, 'split', { token, groups });
          return toolText(
            `Recorded ${groups.length} group(s). Call swarm_report when you are done.`,
          );
        }
        if ((input.task === undefined) === (input.groups === undefined))
          throw new Error('pass either task or groups');
        const { pipeline, ...rest } = input;
        const result = (await ipc(socket, 'worker_queue_add', {
          token,
          pipeline,
          ...rest,
        })) as { item?: string };
        return toolText(
          `Queued ${result.item ?? 'the task'} for pipeline ${String(pipeline)}. It starts when the queue runs.`,
        );
      } catch (error) {
        return toolText((error as Error).message, true);
      }
    },
    async close() {},
  };
}

const [mode, ...args] = process.argv.slice(2);

// AIP_FAKE_ARGV_LOG: a file that gets a JSON line with the arguments and the variables named in
// AIP_FAKE_ENV_KEYS (comma-separated) of every call.
if (process.env.AIP_FAKE_ARGV_LOG) {
  const keys = (process.env.AIP_FAKE_ENV_KEYS ?? '').split(',').filter(Boolean);
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]));
  appendFileSync(process.env.AIP_FAKE_ARGV_LOG, `${JSON.stringify({ mode, argv: args, env })}\n`);
}

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
if (
  args.includes('--no-session-persistence') ||
  args.includes('aip-oneshot') ||
  (mode === 'agy' && args.some((arg) => arg.endsWith('agy-oneshot.json')))
) {
  const state = process.env.AIP_FAKE_STATE;
  const script = process.env.AIP_FAKE_SCRIPT
    ? JSON.parse(readFileSync(process.env.AIP_FAKE_SCRIPT, 'utf8'))
    : {};
  const naming = script.naming as
    { answer?: string; delayMs?: number; waitFor?: string } | undefined;
  if (state) {
    mkdirSync(state, { recursive: true });
    appendFileSync(join(state, 'oneshots.jsonl'), `${JSON.stringify({ mode, args })}\n`);
  }
  if (!naming) process.exit(1);
  if (naming.delayMs) await new Promise((resolve) => setTimeout(resolve, naming.delayMs));
  while (naming.waitFor && !existsSync(naming.waitFor))
    await new Promise((resolve) => setTimeout(resolve, 10));
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
  } else if (mode === 'agy') {
    console.log(
      JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: answer,
          conversation_id: 'conv_naming',
          num_turns: 1,
          usage: { input_tokens: 30, output_tokens: 10 },
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
  server?: string;
} {
  if (mode === 'agy') {
    const config = JSON.parse(
      readFileSync(join(option('--add-dir')!, '.agents', 'mcp_config.json'), 'utf8'),
    );
    const server = Object.values(config.mcpServers)[0] as { command: string; args: string[] };
    return {
      ...server,
      prompt: option('-p') ?? '',
      message: option('-p') ?? '',
      cwd: process.cwd(),
      server: Object.keys(config.mcpServers)[0],
    };
  }
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
if (mode === 'agy')
  console.log(
    JSON.stringify({ event: 'init', conversation_id: option('--conversation') ?? 'conv_fake' }),
  );
const step = /Step: "([^"]+)"/.exec(worker.prompt)?.[1] ?? 'unknown';
const group = /Group: "([^"]+)"/.exec(worker.prompt)?.[1] ?? 'unknown';
mkdirSync(state, { recursive: true });
appendFileSync(
  join(state, 'calls.jsonl'),
  `${JSON.stringify({
    mode,
    step,
    group,
    args,
    cwd: worker.cwd,
    ...(mode === 'opencode' ? { configPath: process.env.OPENCODE_CONFIG } : {}),
    ...(mode === 'agy' ? { workerServer: worker.server } : {}),
  })}\n`,
);
const counterPath = join(state, `count-${group}-${step}`.replace(/[^\w.-]/g, '_'));
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
writeFileSync(counterPath, String(count + 1));
const script = process.env.AIP_FAKE_SCRIPT
  ? JSON.parse(readFileSync(process.env.AIP_FAKE_SCRIPT, 'utf8'))
  : {};
// `step@group` scripts one group of the step; `step` serves every group
const actions: Action[] = script[`${step}@${group}`] ?? script[step] ?? [];
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
for (const [path, target] of Object.entries(action.link ?? {})) {
  symlinkSync(target, join(worker.cwd, path));
}
for (const [path, content] of Object.entries(action.outside ?? {})) writeFileSync(path, content);
if (action.child) {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  appendFileSync(join(state, 'children'), `${child.pid}\n`);
}
if (action.stubbornChild) {
  const child = spawn('sh', ['-c', 'trap "" TERM; while :; do sleep 1; done'], { stdio: 'ignore' });
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
  } else if (mode === 'agy') {
    console.log(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          conversation_id: option('--conversation') ?? 'conv_fake',
          step_index: index,
          state: 'DONE',
          step_type: 'agent_response',
          text_delta: 'working',
          usage: { input_tokens: call.input, output_tokens: call.output },
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
  const client = action.realWorker
    ? await connectWorker(worker.command, worker.args)
    : connectDirect(worker.args);
  appendFileSync(
    join(state, 'worker.jsonl'),
    `${JSON.stringify({ step, group, via: action.realWorker ? 'mcp' : 'direct' })}\n`,
  );
  for (const call of action.toolCalls ?? []) {
    const result = await client.callTool(call);
    appendFileSync(
      join(state, 'tools.jsonl'),
      `${JSON.stringify({ step, group, name: call.name, result })}\n`,
    );
  }
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
      ...(action.humanOnly ? { human_only: true } : {}),
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
} else if (mode === 'agy') {
  if (!action.noResult)
    console.log(
      JSON.stringify({
        event: 'result',
        result: {
          conversation_id: option('--conversation') ?? 'conv_fake',
          status: action.exitCode ? 'ERROR' : 'SUCCESS',
          response: 'done',
          num_turns: option('--conversation') ? 2 : 1,
          usage: {
            input_tokens: liveUsage.length
              ? liveUsage.reduce((sum, call) => sum + call.input, 0)
              : 100,
            output_tokens: liveUsage.length
              ? liveUsage.reduce((sum, call) => sum + call.output, 0)
              : 20,
          },
        },
      }),
    );
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
