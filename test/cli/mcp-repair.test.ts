import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');

async function toolsOf(extra: string[]): Promise<string[]> {
  const client = new Client({ name: 'test', version: '0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [main, 'mcp', '--worker', 't', '--socket', '/tmp/aip-none.sock', ...extra],
  });
  try {
    await client.connect(transport);
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

describe('aip mcp --worker --repair', () => {
  it('serves swarm_repair_* only with the flag', async () => {
    const plain = await toolsOf([]);
    expect(plain.filter((name) => name.startsWith('swarm_repair'))).toEqual([]);
    expect((await toolsOf(['--repair'])).filter((name) => name.startsWith('swarm_repair'))).toEqual(
      ['swarm_repair_answer', 'swarm_repair_cancel', 'swarm_repair_retry'],
    );
  });
});
