import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../../node_modules/.cache/browser-results',
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4178', serviceWorkers: 'block' },
  webServer: {
    cwd: resolve(import.meta.dirname, '../..'),
    command: 'node web/browser/server.ts',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
