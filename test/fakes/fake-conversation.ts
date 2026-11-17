import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The fake codex, kilo, cline and copilot: one script per protocol of the four CLIs that keep a
 * conversation in their own private state. A resume reads the real history file of that state, so a
 * test sees whether the state survived; the worker and the specialist servers are read from the
 * config the adapter wrote for the attempt, and `gate` actions run the generated gate.
 * Scripted through AIP_FAKE_SCRIPT like fake-agent.ts.
 */
interface Action {
  verdict?: 'done' | 'rejected' | 'needs_human';
  summary?: string;
  feedback?: string;
  write?: Record<string, string>;
  /** Tool calls offered to the gate of the CLI; the answers go to gate.jsonl. */
  gate?: { tool: string; args: Record<string, unknown> }[];
  noReport?: boolean;
  hang?: boolean;
  /** Waits until this file exists: the test decides when the agent goes on. */
  waitFor?: string;
  delayMs?: number;
  exitCode?: number;
  realWorker?: boolean;
  /** The id this fake answers with instead of the one it resumed. */
  wrongId?: string;
  noSessionEvent?: boolean;
  usage?: { input: number; output: number };
}

const [mode, ...args] = process.argv.slice(2) as [string, ...string[]];
const env = process.env;
const state = env.AIP_FAKE_STATE!;
mkdirSync(state, { recursive: true });

if (env.AIP_FAKE_ARGV_LOG) {
  const keys = (env.AIP_FAKE_ENV_KEYS ?? '').split(',').filter(Boolean);
  appendFileSync(
    env.AIP_FAKE_ARGV_LOG,
    `${JSON.stringify({ mode, argv: args, env: Object.fromEntries(keys.map((key) => [key, env[key] ?? null])) })}\n`,
  );
}

const script = env.AIP_FAKE_SCRIPT ? JSON.parse(readFileSync(env.AIP_FAKE_SCRIPT, 'utf8')) : {};
const emit = (value: unknown) => console.log(JSON.stringify(value));
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

interface Layout {
  /** The folder the history of the conversations lives in. */
  history: string;
  /** The config file or files that name the servers of the attempt. */
  prompt: string;
  resume: string | null;
  server: { command: string; args: string[] } | null;
  serverNames: string[];
  gate: ((request: unknown) => string) | null;
  oneShot: boolean;
}

function readServers(map: Record<string, { command: string | string[]; args?: string[] }>) {
  const names = Object.keys(map).filter((name) => name.startsWith('aip-'));
  const worker = names.sort((a, b) => a.length - b.length)[0];
  const server = worker ? map[worker]! : null;
  const command = Array.isArray(server?.command) ? server.command : [server?.command ?? ''];
  return {
    serverNames: names,
    server: server
      ? { command: command[0]!, args: [...command.slice(1), ...(server.args ?? [])] }
      : null,
  };
}

function runGate(command: string, request: unknown): string {
  const result = spawnSync('sh', ['-c', command], {
    input: JSON.stringify(request),
    encoding: 'utf8',
  });
  return result.stdout;
}

function layout(): Layout {
  if (mode === 'codex') {
    const home = env.CODEX_HOME!;
    const oneShot = args.includes('--ephemeral');
    const index = args.indexOf('resume');
    const text = existsSync(join(home, 'config.toml'))
      ? readFileSync(join(home, 'config.toml'), 'utf8')
      : '';
    const map: Record<string, { command: string; args: string[] }> = {};
    let worker: { command: string; args: string[] } | null = null;
    for (const table of text.split(/^\[mcp_servers\./m).slice(1)) {
      const name = table.slice(0, table.indexOf(']'));
      const entry = {
        command: JSON.parse(/^command = (.+)$/m.exec(table)![1]!) as string,
        args: JSON.parse(/^args = (.+)$/m.exec(table)![1]!) as string[],
      };
      map[name] = entry;
      if (table.includes('enabled_tools')) worker = entry;
    }
    return {
      history: join(home, 'sessions'),
      prompt: args.at(-1)!,
      resume: index === -1 ? null : args[index + 1]!,
      server: worker,
      serverNames: Object.keys(map),
      gate: null,
      oneShot,
    };
  }
  if (mode === 'kilo') {
    const config = join(env.XDG_CONFIG_HOME!, 'kilo', 'kilo.json');
    const parsed = existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')) : {};
    return {
      history: join(env.XDG_DATA_HOME!, 'kilo', 'sessions'),
      prompt: args.at(-1)!,
      resume: option('-s') ?? null,
      ...readServers(parsed.mcp ?? {}),
      gate: null,
      oneShot: parsed.mcp === undefined,
    };
  }
  if (mode === 'cline') {
    const config = option('--config')!;
    const settings = join(config, 'settings.json');
    const parsed = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')) : {};
    const hook = join(config, 'hooks', 'PreToolUse');
    return {
      history: join(option('--data-dir')!, 'sessions'),
      prompt: args.at(-1)!,
      resume: option('--id') ?? null,
      ...readServers(parsed.mcpServers ?? {}),
      gate: existsSync(hook) ? (request) => runGate(hook, request) : null,
      oneShot: parsed.mcpServers === undefined,
    };
  }
  const home = env.COPILOT_HOME!;
  const mcp = join(home, 'mcp-config.json');
  const parsed = existsSync(mcp) ? JSON.parse(readFileSync(mcp, 'utf8')) : {};
  const hooks = join(home, 'hooks', 'aip.json');
  const hook = existsSync(hooks)
    ? JSON.parse(readFileSync(hooks, 'utf8')).hooks.preToolUse[0].bash
    : null;
  const resume = args.find((arg) => arg.startsWith('--session-id='));
  return {
    history: join(home, 'session-state'),
    prompt: option('-p')!,
    resume: resume ? resume.slice('--session-id='.length) : null,
    ...readServers(parsed.mcpServers ?? {}),
    gate: hook ? (request) => runGate(hook, request) : null,
    oneShot: parsed.mcpServers === undefined,
  };
}

const lay = layout();
const idOf = () => `${mode}-session-${Math.random().toString(36).slice(2, 10)}`;

function start(id: string, wrong: boolean): void {
  if (mode === 'codex') emit({ type: 'thread.started', thread_id: id });
  else if (mode === 'cline') emit({ type: 'task_started', taskId: id });
  else if (mode === 'copilot' && !wrong) emit({ type: 'session.start', data: { sessionId: id } });
  else if (mode === 'copilot') emit({ type: 'session.start', data: { sessionId: id } });
}

function say(id: string, text: string): void {
  if (mode === 'codex')
    emit({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text } });
  else if (mode === 'kilo') emit({ type: 'text', sessionID: id, part: { type: 'text', text } });
  else if (mode === 'cline') emit({ type: 'say', say: 'text', text });
  else emit({ type: 'assistant.message', data: { content: text } });
}

function usage(id: string, input: number, output: number): void {
  if (mode === 'codex')
    emit({ type: 'turn.completed', usage: { input_tokens: input, output_tokens: output } });
  else if (mode === 'kilo') {
    emit({
      type: 'step_finish',
      sessionID: id,
      part: { type: 'step-finish', tokens: { input, output, cache: { read: 0, write: 0 } } },
    });
  } else if (mode === 'cline') {
    emit({
      type: 'say',
      say: 'api_req_started',
      text: JSON.stringify({ tokensIn: input, tokensOut: output }),
    });
  } else emit({ type: 'assistant.usage', data: { inputTokens: input, outputTokens: output } });
}

if (lay.oneShot) {
  const naming = script.naming as { answer?: string } | undefined;
  appendFileSync(join(state, 'oneshots.jsonl'), `${JSON.stringify({ mode, args })}\n`);
  if (!naming) process.exit(1);
  say('naming', naming.answer ?? '');
  process.exit(0);
}

// The history of the private state: a resume of an id the state does not hold is an error.
const resumed = lay.resume;
const sessionId = resumed ?? idOf();
const historyFile = join(lay.history, `${sessionId}.jsonl`);
let before = 0;
if (resumed !== null) {
  if (!existsSync(historyFile)) {
    emit({ type: 'error', message: `no history for ${resumed}` });
    process.exit(3);
  }
  before = readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).length;
}
mkdirSync(lay.history, { recursive: true });
appendFileSync(historyFile, `${JSON.stringify({ prompt: lay.prompt })}\n`);

const step = /Step: "([^"]+)"/.exec(lay.prompt)?.[1] ?? 'unknown';
const group = /Group: "([^"]+)"/.exec(lay.prompt)?.[1] ?? 'unknown';
const workerArgs = lay.server?.args ?? [];
appendFileSync(
  join(state, 'calls.jsonl'),
  `${JSON.stringify({
    mode,
    step,
    group,
    args,
    cwd: process.cwd(),
    resume: resumed,
    sessionId,
    historyBefore: before,
    historyFile,
    worker: lay.server,
    workerToken: workerArgs[workerArgs.indexOf('--worker') + 1] ?? null,
    serverNames: lay.serverNames,
    home: env.CODEX_HOME ?? env.COPILOT_HOME ?? env.XDG_DATA_HOME ?? option('--config') ?? null,
  })}\n`,
);
const counterPath = join(state, `count-${group}-${step}`.replace(/[^\w.-]/g, '_'));
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
writeFileSync(counterPath, String(count + 1));
const actions: Action[] = script[`${step}@${group}`] ?? script[step] ?? [];
const action: Action = actions[Math.min(count, actions.length - 1)] ?? {};

if (!action.noSessionEvent) start(action.wrongId ?? sessionId, action.wrongId !== undefined);
say(sessionId, 'working');
const used = action.usage ?? { input: 100, output: 20 };
usage(sessionId, used.input, used.output);
for (const [path, content] of Object.entries(action.write ?? {})) {
  mkdirSync(dirname(join(process.cwd(), path)), { recursive: true });
  writeFileSync(join(process.cwd(), path), content);
}
for (const call of action.gate ?? []) {
  const answer = lay.gate ? lay.gate(request(call)) : 'no gate';
  appendFileSync(
    join(state, 'gate.jsonl'),
    `${JSON.stringify({ step, group, tool: call.tool, answer })}\n`,
  );
}

function request(call: { tool: string; args: Record<string, unknown> }): unknown {
  if (mode === 'cline')
    return { hookName: 'PreToolUse', preToolUse: { toolName: call.tool, parameters: call.args } };
  return { cwd: process.cwd(), toolName: call.tool, toolArgs: JSON.stringify(call.args) };
}

if (action.delayMs) await new Promise((resolve) => setTimeout(resolve, action.delayMs));
while (action.waitFor && !existsSync(action.waitFor))
  await new Promise((resolve) => setTimeout(resolve, 20));
if (action.hang) await new Promise(() => setInterval(() => undefined, 1000));

/** One request to the daemon socket: the same line protocol as the client of aip. */
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

/** The report through the real worker MCP server over stdio. */
async function reportThroughWorker(
  server: { command: string; args: string[] },
  input: Record<string, unknown>,
) {
  const child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map<number, () => void>();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, end)) as { id?: number };
      buffer = buffer.slice(end + 1);
      if (message.id !== undefined) pending.get(message.id)?.();
    }
  });
  const call = (id: number, method: string, params: Record<string, unknown>) =>
    new Promise<void>((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  await call(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fake', version: '0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await call(2, 'tools/call', { name: 'swarm_report', arguments: input });
  child.stdin.end();
}

if (!action.noReport && lay.server) {
  const option2 = (name: string) => workerArgs[workerArgs.indexOf(name) + 1]!;
  const input = {
    verdict: action.verdict ?? 'done',
    summary: action.summary ?? `${mode} done`,
    ...(action.feedback ? { feedback: action.feedback } : {}),
  };
  if (action.realWorker) await reportThroughWorker(lay.server, input);
  else {
    await ipc(option2('--socket'), 'report', {
      token: option2('--worker'),
      verdict: input.verdict,
      summary: input.summary,
      feedback: action.feedback ?? null,
      questions: null,
    });
  }
  appendFileSync(
    join(state, 'worker.jsonl'),
    `${JSON.stringify({ step, group, via: action.realWorker ? 'mcp' : 'direct' })}\n`,
  );
}
process.exit(action.exitCode ?? 0);
