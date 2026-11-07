import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `aip web` serves the build from dist/web. For development run `aip web`, then
// AIP_WEB_URL=http://127.0.0.1:7341 AIP_WEB_TOKEN=<token from its URL> npx vite --config web/vite.config.ts
const target = process.env.AIP_WEB_URL ?? 'http://127.0.0.1:7341';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules\/(react|react-dom|scheduler)\//,
              priority: 30,
            },
            {
              name: 'vendor-markdown',
              test: /node_modules\/(react-markdown|remark-|mdast-|micromark|hast-|unist-|unified|vfile|property-information)/,
              priority: 20,
            },
            { name: 'locales', test: /web\/src\/shared\/i18n\/locales\//, priority: 20 },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        headers: { 'x-aip-token': process.env.AIP_WEB_TOKEN ?? '' },
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => request.removeHeader('origin'));
        },
      },
    },
  },
});
