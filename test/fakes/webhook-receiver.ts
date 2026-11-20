import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface ReceivedWebhook {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** The raw body: what the signature covers. */
  body: string;
}

export interface FakeReceiver {
  /** `http://127.0.0.1:<port>`; no trailing slash. */
  base: string;
  received: ReceivedWebhook[];
  /** Consumed one per request: the answer to give; with none left the receiver answers 200. */
  answers: { status: number; headers?: Record<string, string>; body?: string; delayMs?: number }[];
  /** Resolves when `count` requests have arrived. */
  waitFor(count: number): Promise<void>;
  close(): Promise<void>;
}

/** A receiver of webhooks on loopback that records every request and answers as it is told. */
export async function startReceiver(): Promise<FakeReceiver> {
  const received: ReceivedWebhook[] = [];
  const answers: FakeReceiver['answers'] = [];
  const waiting: { count: number; resolve: () => void }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      for (const one of [...waiting]) {
        if (received.length >= one.count) {
          waiting.splice(waiting.indexOf(one), 1);
          one.resolve();
        }
      }
      const answer = answers.shift() ?? { status: 200 };
      setTimeout(() => {
        response.writeHead(answer.status, answer.headers ?? {});
        response.end(answer.body ?? '');
      }, answer.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    base: `http://127.0.0.1:${port}`,
    received,
    answers,
    waitFor: (count) =>
      received.length >= count
        ? Promise.resolve()
        : new Promise((resolve) => waiting.push({ count, resolve })),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
