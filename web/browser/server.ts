import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'vite';
import { serveAsset, servePage } from '../../src/presentation/web/pages.ts';

const assets = resolve('node_modules/.cache/diagram-browser');
await build({
  configFile: 'web/vite.config.ts',
  root: resolve('web/browser'),
  publicDir: false,
  build: { outDir: assets, emptyOutDir: true },
});
let canaryRequests = 0;
const server = createServer((request, response) => {
  const pathname = new URL(request.url!, 'http://127.0.0.1').pathname;
  if (pathname.includes('private-diagram-marker')) canaryRequests++;
  if (pathname === '/__canary-count') {
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(canaryRequests));
    return;
  }
  try {
    // Exercise the production response headers, not an approximation in a dev server.
    if (pathname === '/') servePage(response, assets, null, undefined, undefined);
    else serveAsset(response, assets, pathname);
  } catch {
    response.writeHead(404).end();
  }
});
server.on('upgrade', (_request, socket) => {
  canaryRequests++;
  socket.destroy();
});
server.listen(4178, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
