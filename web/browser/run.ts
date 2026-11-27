import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

// Keep downloaded browsers and reports inside the checkout; never use a developer's profile.
const args = process.argv.slice(2);
const temporary = resolve('node_modules/.cache/browser-tmp');
mkdirSync(temporary, { recursive: true });
if (args[0] === 'test') args.push('--config', 'web/browser/playwright.config.ts');
const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: resolve('node_modules/.cache/ms-playwright'),
    TMPDIR: temporary,
  },
});
process.exit(result.status ?? 1);
