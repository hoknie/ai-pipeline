import type { RegistryTransportPort } from '../ports/index.ts';
import {
  LIST_PAGE_SIZE,
  MAX_ARCHIVE_BYTES,
  MAX_LIST_PAGES,
  RegistryFailure,
  SKILL_TIMEOUT_MS,
  type McpEndpoint,
  type RegistrySkill,
} from '../types/index.ts';

import { PROTOCOL_VERSION } from './adapter.ts';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function versionOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value.version === 'string') return value.version;
  return null;
}

function skillOf(value: unknown): RegistrySkill | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  const versions = Array.isArray(value.versions) ? value.versions : [];
  return {
    id: value.id,
    name: value.name,
    title: text(value.title),
    description: text(value.description),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === 'string') : [],
    versions: versions.flatMap((version) => versionOf(version) ?? []),
  };
}

/** The data of a `tools/call` answer: structured content, else the JSON text of the first block. */
function payloadOf(message: Record<string, unknown> | null): Record<string, unknown> {
  const result = message?.result;
  if (!isObject(result) || result.isError === true) throw new RegistryFailure('protocol');
  if (isObject(result.structuredContent)) return result.structuredContent;
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!isObject(first) || typeof first.text !== 'string') throw new RegistryFailure('protocol');
  try {
    const parsed: unknown = JSON.parse(first.text);
    if (isObject(parsed)) return parsed;
  } catch {
    // falls through to the failure below
  }
  throw new RegistryFailure('protocol');
}

/** What the daemon asks of a registry for skills: the list over MCP and the archive over REST. */
export class SkillSource {
  private readonly transport: RegistryTransportPort;

  constructor(transport: RegistryTransportPort) {
    this.transport = transport;
  }

  /**
   * The skills `list_skills` finds for the query, page after page up to the limit of pages.
   * A failure throws a `RegistryFailure`.
   */
  async list(endpoint: McpEndpoint, query: string): Promise<RegistrySkill[]> {
    const signal = endpoint.signal ?? AbortSignal.timeout(SKILL_TIMEOUT_MS);
    const session: McpEndpoint = {
      ...endpoint,
      signal,
      timeoutMs: endpoint.timeoutMs ?? SKILL_TIMEOUT_MS,
    };
    const opened = await this.transport.post(session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'aip', version: '1' },
      },
    });
    if (opened.message === null || 'error' in opened.message) throw new RegistryFailure('protocol');
    session.sessionId = opened.sessionId;
    try {
      await this.transport.post(session, { jsonrpc: '2.0', method: 'notifications/initialized' });
      return await this.pages(session, query);
    } finally {
      await this.transport.close(session);
    }
  }

  private async pages(session: McpEndpoint, query: string): Promise<RegistrySkill[]> {
    const found: RegistrySkill[] = [];
    let cursor: string | null = null;
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
      const reply = await this.transport.post(session, {
        jsonrpc: '2.0',
        id: page + 1,
        method: 'tools/call',
        params: {
          name: 'list_skills',
          arguments: {
            ...(query === '' ? {} : { query }),
            limit: LIST_PAGE_SIZE,
            page,
            ...(cursor === null ? {} : { cursor }),
          },
        },
      });
      const payload = payloadOf(reply.message);
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        const skill = skillOf(item);
        if (skill !== null) found.push(skill);
      }
      cursor = typeof payload.next_cursor === 'string' ? payload.next_cursor : null;
      const more =
        cursor !== null || payload.has_more === true || typeof payload.next_page === 'number';
      if (!more || items.length === 0) break;
    }
    return found;
  }

  /** The zip archive of one version of a skill. */
  archive(endpoint: McpEndpoint, id: string, version: string): Promise<Buffer> {
    const path = `/api/v1/skills/${encodeURIComponent(id)}/archive?version=${encodeURIComponent(version)}`;
    return this.transport.download(
      {
        ...endpoint,
        signal: endpoint.signal ?? AbortSignal.timeout(SKILL_TIMEOUT_MS),
        timeoutMs: endpoint.timeoutMs ?? SKILL_TIMEOUT_MS,
      },
      path,
      MAX_ARCHIVE_BYTES,
    );
  }
}
