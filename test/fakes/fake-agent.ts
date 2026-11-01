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
  /** Calls swarm_queue_add with these arguments; its text result goes to queued.jsonl. */
  queue?: Record<string, unknown>;
  delayMs?: number;
  noReport?: boolean;
  hang?: boolean;
  child?: boolean;
  exitCode?: number;
  /** Refused shell commands, reported the way Claude Code does: as events and in the result. */
  denied?: string[];
}

const [mode, ...args] = process.argv.slice(2);

if (args[0] === '--version') {
  console.log(`fake ${mode} 0.0.0`);
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
if (action.delayMs) await new Promise((resolve) => setTimeout(resolve, action.delayMs));
if (action.hang) await new Promise(() => setInterval(() => undefined, 1000));

const session =
  mode === 'claude' ? (option('--session-id') ?? option('--resume') ?? 'none') : 'ses_fake';
if (!action.noReport) {
  const client = new Client({ name: 'fake-agent', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: worker.command, args: worker.args, stderr: 'inherit' }),
  );
  if (action.split)
    await client.callTool({ name: 'swarm_split', arguments: { groups: action.split } });
  if (action.queue) {
    const queued = await client.callTool({ name: 'swarm_queue_add', arguments: action.queue });
    appendFileSync(join(state, 'queued.jsonl'), `${JSON.stringify({ step, group, queued })}\n`);
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
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: session,
      total_cost_usd: 0.01,
      permission_denials: denied,
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 20,
      },
    }),
  );
} else {
  console.log(JSON.stringify({ type: 'step_start', sessionID: session }));
  console.log(
    JSON.stringify({
      type: 'step_finish',
      sessionID: session,
      part: {
        type: 'step-finish',
        tokens: { input: 50, output: 10, cache: { read: 0, write: 0 } },
        cost: 0.002,
      },
    }),
  );
}
process.exit(action.exitCode ?? 0);
