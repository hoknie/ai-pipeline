import { artifactPreview } from '../../../feature/artifacts/types/index.ts';
import type {
  ArtifactContentView,
  AttachmentContentView,
  RunPatchView,
} from '../../ipc/contract/index.ts';
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

/** Types a browser may show inline: the pictures it renders safely and plain text. */
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function inlineType(file: AttachmentContentView): string | null {
  if (INLINE_IMAGES.has(file.mediaType)) return file.mediaType;
  return /\.(md|txt|log)$/i.test(file.fileName) ? 'text/plain; charset=utf-8' : null;
}

/** `GET /api/runs/<run>/attachments/<id>`: the file, or with `?inline=1` a picture or text for display. */
export function attachmentRoute({ call }: RouteKit): RawRoute {
  return {
    pattern: new RegExp(`^/api/runs/${segment}/attachments/${segment}$`),
    async handle({ response, url, match, verb }) {
      if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
      const [runId = '', id = ''] = decodeParts(match.slice(1));
      const inline = url.searchParams.get('inline') === '1';
      const file = (await call('attachment', { runId, id })) as AttachmentContentView;
      const shown = inlineType(file);
      if (inline && shown === null) {
        throw panel(
          'invalid',
          'only pictures (PNG, JPEG, GIF, WebP) and .md, .txt, .log files can be shown inline',
        );
      }
      const bytes = Buffer.from(file.base64, 'base64');
      const download = attachmentHeaders(file.fileName, null);
      response.writeHead(200, {
        'Content-Length': bytes.length,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        ...(inline && shown !== null
          ? {
              'Content-Type': shown,
              'Content-Disposition': download['Content-Disposition']!.replace(
                /^attachment/,
                'inline',
              ),
            }
          : download),
      });
      response.end(bytes);
    },
  };
}
