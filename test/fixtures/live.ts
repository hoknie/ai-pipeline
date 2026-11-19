import { WebSocket } from 'ws';

/** A client of the live connection of the panel that keeps what it was sent. */
export interface LiveProbe {
  /** Every message so far, one per line. */
  text: string;
  messages: Record<string, unknown>[];
  /** Waits until the text has `needle`; returns the text either way. */
  until(needle: string, timeoutMs?: number): Promise<string>;
  /** Waits for a message that passes the check. */
  message(
    what: string,
    check: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>>;
  send(message: unknown): void;
  close(): void;
  /** The close code, once the connection is closed. */
  closed: Promise<number>;
}

/** The status of the answer to a request that was not allowed to open the connection. */
export function liveStatus(base: string, headers: Record<string, string> = {}): Promise<number> {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/ws`, { headers });
  return new Promise((resolve, reject) => {
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.on('open', () => {
      socket.close();
      resolve(101);
    });
    socket.on('error', reject);
  });
}

export function openLive(base: string, headers: Record<string, string> = {}): Promise<LiveProbe> {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/ws`, { headers });
  const probe: LiveProbe = {
    text: '',
    messages: [],
    async until(needle, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (!probe.text.includes(needle) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return probe.text;
    },
    async message(what, check) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const found = probe.messages.find(check);
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${what}; got: ${probe.text.slice(0, 2000)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    send: (message) => socket.send(typeof message === 'string' ? message : JSON.stringify(message)),
    close: () => socket.close(),
    closed: new Promise((resolve) => socket.on('close', (code) => resolve(code))),
  };
  socket.on('message', (data) => {
    const text = String(data);
    probe.text += `${text}\n`;
    probe.messages.push(JSON.parse(text) as Record<string, unknown>);
  });
  return new Promise((resolve, reject) => {
    socket.on('open', () => resolve(probe));
    socket.on('error', reject);
    socket.on('unexpected-response', (_request, response) =>
      reject(new Error(`the server answered ${response.statusCode}`)),
    );
  });
}
