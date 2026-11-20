import { createServer } from 'node:http';

import { acceptWebSocket, type WsPeer } from './ws-server.ts';

export type FakeBlock = Record<string, unknown> & { type: string; block_id?: string };

export interface FakeSlackCall {
  method: string;
  token: string;
  body: Record<string, unknown>;
}

export interface FakeSlackMessage {
  channel: string;
  ts: string;
  thread_ts?: string;
  text: string;
  blocks: FakeBlock[];
}

export interface FakeSlackEphemeral {
  channel: string;
  user: string;
  text: string;
  thread_ts?: string;
}

export interface FakeSlackFailure {
  status?: number;
  error?: string;
  retryAfter?: number;
}

export interface FakeSlack {
  /** The base address of the Web API, `http://127.0.0.1:<port>/api`. */
  base: string;
  botToken: string;
  appToken: string;
  calls: FakeSlackCall[];
  messages: FakeSlackMessage[];
  ephemerals: FakeSlackEphemeral[];
  /** Consumed one per call of the method: the answer to give instead of the normal one. */
  failures: Map<string, FakeSlackFailure[]>;
  /** The scopes `auth.test` reports in `x-oauth-scopes`. */
  scopes: string;
  /** Every Socket Mode connection that was accepted, the newest last. */
  peers: WsPeer[];
  /** How many connections are open now. */
  open(): number;
  callsOf(method: string): FakeSlackCall[];
  /** The envelope ids the client acknowledged, in order. */
  acks(): string[];
  /** Sends an envelope to the newest connection. */
  envelope(type: string, payload: unknown, id?: string): string;
  press(options: {
    channel: string;
    user: string;
    message: string;
    thread?: string;
    actionId: string;
    selected?: string;
    team?: string;
    actionTs?: string;
    envelopeId?: string;
  }): string;
  reply(options: {
    channel: string;
    user: string;
    thread?: string | undefined;
    text: string;
    team?: string;
    envelopeId?: string;
    extra?: Record<string, unknown>;
  }): string;
  disconnect(reason: string): void;
  /** Drops every connection without a close frame. */
  drop(): void;
  close(): Promise<void>;
}

/** What Slack refuses with `invalid_blocks`: repeated ids and texts over the limits. */
export function blocksProblem(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return 'blocks is not a list';
  if (blocks.length > 50) return 'more than 50 blocks';
  const blockIds = new Set<string>();
  const actionIds = new Set<string>();
  for (const block of blocks as FakeBlock[]) {
    if (block.block_id !== undefined) {
      if (blockIds.has(block.block_id)) return `duplicate block_id ${block.block_id}`;
      blockIds.add(block.block_id);
    }
    const text = (block.text as { text?: string } | undefined)?.text;
    const limit = block.type === 'header' ? 150 : 3000;
    if (text !== undefined && [...text].length > limit) return `a ${block.type} text is too long`;
    const elements = (block.elements as Record<string, unknown>[] | undefined) ?? [];
    if (block.type === 'actions' && elements.length > 25) return 'more than 25 elements';
    if (block.type === 'context' && elements.length > 10) return 'more than 10 context elements';
    if (block.type !== 'actions') continue;
    for (const element of elements) {
      const id = element.action_id;
      if (typeof id === 'string') {
        // Slack refuses a repeat inside a block; the fake refuses it in the whole message.
        if (actionIds.has(id)) return `duplicate action_id ${id}`;
        actionIds.add(id);
        if (id.length > 255) return 'action_id is too long';
      }
      if (typeof element.value === 'string' && element.value.length > 2000) return 'value too long';
      const label = (element.text as { text?: string } | undefined)?.text;
      if (label !== undefined && [...label].length > 75) return 'a label is too long';
      for (const option of (element.options as { text: { text: string } }[] | undefined) ?? []) {
        if ([...option.text.text].length > 75) return 'an option label is too long';
      }
    }
  }
  return null;
}

/** A Slack on loopback: the Web API calls the adapter makes, and a Socket Mode WebSocket. */
export async function startFakeSlack(
  tokens: { bot?: string; app?: string } = {},
): Promise<FakeSlack> {
  const botToken = tokens.bot ?? 'xoxb-test-bot-token';
  const appToken = tokens.app ?? 'xapp-1-test-app-token';
  const calls: FakeSlackCall[] = [];
  const messages: FakeSlackMessage[] = [];
  const ephemerals: FakeSlackEphemeral[] = [];
  const failures = new Map<string, FakeSlackFailure[]>();
  const peers: WsPeer[] = [];
  let scopes = 'chat:write,channels:history,groups:history';
  let clock = 1_700_000_000;
  let envelopes = 0;
  const nextTs = (): string => `${clock++}.000100`;

  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const method = /^\/api\/([\w.]+)$/.exec(request.url ?? '')?.[1];
    const reply = (payload: unknown, headers: Record<string, string> = {}, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(payload));
    };
    if (method === undefined) return reply({ ok: false, error: 'unknown_method' }, {}, 404);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<
      string,
      unknown
    >;
    const given = /^Bearer (.+)$/.exec(String(request.headers.authorization))?.[1] ?? '';
    calls.push({ method, token: given, body });
    const expected = method === 'apps.connections.open' ? appToken : botToken;
    if (given !== expected) return reply({ ok: false, error: 'invalid_auth' });
    const failure = failures.get(method)?.shift();
    if (failure !== undefined) {
      if (failure.status === 429) {
        return reply(
          { ok: false, error: 'ratelimited' },
          { 'retry-after': String(failure.retryAfter ?? 1) },
          429,
        );
      }
      return reply({ ok: false, error: failure.error ?? 'internal_error' }, {}, failure.status);
    }
    switch (method) {
      case 'auth.test':
        return reply({ ok: true, team_id: 'T0123456789' }, { 'x-oauth-scopes': scopes });
      case 'apps.connections.open':
        return reply({ ok: true, url: `ws://127.0.0.1:${port()}/link?ticket=secret` });
      case 'chat.postMessage': {
        const problem = body.blocks === undefined ? null : blocksProblem(body.blocks);
        if (problem !== null) return reply({ ok: false, error: 'invalid_blocks' });
        const message: FakeSlackMessage = {
          channel: String(body.channel),
          ts: nextTs(),
          text: String(body.text ?? ''),
          blocks: (body.blocks as FakeBlock[] | undefined) ?? [],
          ...(typeof body.thread_ts === 'string' ? { thread_ts: body.thread_ts } : {}),
        };
        messages.push(message);
        return reply({ ok: true, channel: message.channel, ts: message.ts });
      }
      case 'chat.update': {
        const found = messages.find((one) => one.channel === body.channel && one.ts === body.ts);
        if (found === undefined) return reply({ ok: false, error: 'message_not_found' });
        if (blocksProblem(body.blocks) !== null)
          return reply({ ok: false, error: 'invalid_blocks' });
        found.text = String(body.text ?? '');
        found.blocks = body.blocks as FakeBlock[];
        return reply({ ok: true, channel: found.channel, ts: found.ts });
      }
      case 'chat.postEphemeral':
        ephemerals.push({
          channel: String(body.channel),
          user: String(body.user),
          text: String(body.text),
          ...(typeof body.thread_ts === 'string' ? { thread_ts: body.thread_ts } : {}),
        });
        return reply({ ok: true, message_ts: nextTs() });
      default:
        return reply({ ok: false, error: 'unknown_method' });
    }
  });
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket) => {
    const peer = acceptWebSocket(request, socket);
    peers.push(peer);
    setImmediate(() => peer.sendText(JSON.stringify({ type: 'hello', num_connections: 1 })));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (): number => (server.address() as { port: number }).port;

  const live = (): WsPeer => {
    const peer = peers.findLast((one) => !one.closed);
    if (peer === undefined) throw new Error('no Socket Mode connection');
    return peer;
  };
  const envelope: FakeSlack['envelope'] = (type, payload, id) => {
    const envelopeId = id ?? `env-${++envelopes}`;
    live().sendText(
      JSON.stringify({ envelope_id: envelopeId, type, payload, accepts_response_payload: false }),
    );
    return envelopeId;
  };

  return {
    base: `http://127.0.0.1:${port()}/api`,
    botToken,
    appToken,
    calls,
    messages,
    ephemerals,
    failures,
    get scopes() {
      return scopes;
    },
    set scopes(value: string) {
      scopes = value;
    },
    peers,
    open: () => peers.filter((one) => !one.closed).length,
    callsOf: (method) => calls.filter((call) => call.method === method),
    acks: () =>
      peers.flatMap((peer) =>
        peer.received.flatMap((text) => {
          const id = (JSON.parse(text) as { envelope_id?: string }).envelope_id;
          return id === undefined ? [] : [id];
        }),
      ),
    envelope,
    press: ({ channel, user, message, thread, actionId, selected, team, actionTs, envelopeId }) =>
      envelope(
        'interactive',
        {
          type: 'block_actions',
          user: { id: user },
          team: { id: team ?? 'T0123456789' },
          channel: { id: channel },
          message: { ts: message, ...(thread === undefined ? {} : { thread_ts: thread }) },
          actions: [
            {
              action_id: actionId,
              block_id: 'whatever',
              action_ts: actionTs ?? `${clock++}.500000`,
              type: selected === undefined ? 'button' : 'static_select',
              ...(selected === undefined
                ? { value: actionId }
                : { selected_option: { value: selected } }),
            },
          ],
        },
        envelopeId,
      ),
    reply: ({ channel, user, thread, text, team, envelopeId, extra }) =>
      envelope(
        'events_api',
        {
          team_id: team ?? 'T0123456789',
          event: {
            type: 'message',
            channel,
            user,
            text,
            ts: nextTs(),
            ...(thread === undefined ? {} : { thread_ts: thread }),
            ...extra,
          },
        },
        envelopeId,
      ),
    disconnect: (reason) => live().sendText(JSON.stringify({ type: 'disconnect', reason })),
    drop: () => {
      for (const peer of peers) if (!peer.closed) peer.destroy();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
