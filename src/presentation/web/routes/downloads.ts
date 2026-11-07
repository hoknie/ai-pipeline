import { artifactPreview } from '../../../feature/artifacts/types/index.ts';
import type { ArtifactContentView, RunPatchView } from '../../ipc/contract/index.ts';
import { panel } from '../errors.ts';
import { decodeParts } from '../http.ts';
import { segment, type RawRoute, type RouteKit } from './types.ts';

/** `GET /api/runs/<run>/patch`: the patch of the merged groups as a file. */
export function patchRoute({ call }: RouteKit): RawRoute {
  return {
    pattern: new RegExp(`^/api/runs/${segment}/patch$`),
    async handle({ response, match, verb }) {
      if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
      const [runId = ''] = decodeParts(match.slice(1));
      const patch = (await call('run_patch', { runId })) as RunPatchView;
      const bytes = Buffer.from(patch.base64, 'base64');
      response.writeHead(200, {
        'Content-Type': 'text/x-diff; charset=binary',
        'Content-Disposition': `attachment; filename="${patch.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
    },
  };
}

function attachmentHeaders(fileName: string, preview: string | null): Record<string, string> {
  const type =
    preview === 'markdown'
      ? 'text/markdown; charset=utf-8'
      : preview === 'log'
        ? 'text/plain; charset=utf-8'
        : 'application/octet-stream';
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  };
}

/** `GET /api/runs/<run>/groups/<group>/artifacts/<id>`: the file, or its text with `?inline=1`. */
export function artifactRoute({ call }: RouteKit): RawRoute {
  return {
    pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/artifacts/${segment}$`),
    async handle({ response, url, match, verb }) {
      if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
      const [runId = '', group = '', id = ''] = decodeParts(match.slice(1));
      const inline = url.searchParams.get('inline') === '1';
      const artifact = (await call('artifact', { runId, group, id })) as ArtifactContentView;
      const preview = artifactPreview(artifact.fileName);
      if (inline && preview === null) {
        throw panel('invalid', 'only .md and .log artifacts can be shown inline');
      }
      const bytes = Buffer.from(artifact.base64, 'base64');
      response.writeHead(200, {
        'Content-Length': bytes.length,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        ...(inline
          ? { 'Content-Type': 'text/plain; charset=utf-8' }
          : attachmentHeaders(artifact.fileName, preview)),
      });
      response.end(bytes);
    },
  };
}
