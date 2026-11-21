import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

const shared = {
  exclude: [...configDefaults.exclude, 'integrations/**'],
  globalSetup: ['test/global-setup.ts'],
  setupFiles: ['test/setup.ts', 'web/test/setup.ts'],
};

// End-to-end tests start a daemon, real git repositories and agent processes; they live in their
// own project with a higher limit (see test/slow-test-reporter.ts).
const endToEnd = [
  'test/daemon/**/*.test.ts',
  'test/cli/**/*.test.ts',
  'test/git/**/*.test.ts',
  'test/dev/**/*.test.ts',
  'test/install-script.test.ts',
  'test/global-setup.test.ts',
  'test/protocol/autostart.test.ts',
  // these two start a process for every check: the generated gate script, the keyring tools
  'test/feature/agents/gates.test.ts',
  'test/platform/secrets/keyring.test.ts',
];

// The golden set: one end-to-end file for each main path (a run of a pipeline, the report of a
// specialist, the queue, delivery into the working tree, the CLI and its daemon). `npm run check` and
// CI run these with AIP_E2E=golden; `npm run check:full` and the nightly CI job run every file.
const golden = [
  'test/daemon/flow.test.ts',
  'test/daemon/worker-mcp.test.ts',
  'test/daemon/config.test.ts',
  'test/daemon/queue.test.ts',
  'test/daemon/patches-flow.test.ts',
  'test/daemon/serial.test.ts',
  'test/daemon/lock.test.ts',
  'test/git/delivery.test.ts',
  'test/git/workspace.test.ts',
  'test/cli/cli.test.ts',
  'test/cli/daemon.test.ts',
  'test/cli/init.test.ts',
  'test/cli/help.test.ts',
  'test/protocol/autostart.test.ts',
];

export default defineConfig({
  plugins: [react()],
  test: {
    reporters: ['default', './test/slow-test-reporter.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...shared.exclude, ...endToEnd],
          globalSetup: shared.globalSetup,
          setupFiles: shared.setupFiles,
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          // Tests of the web panel render the whole application in jsdom; each declares
          // `@vitest-environment jsdom` itself.
          name: 'web',
          include: ['web/**/*.test.tsx'],
          exclude: shared.exclude,
          globalSetup: shared.globalSetup,
          setupFiles: shared.setupFiles,
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: process.env.AIP_E2E === 'golden' ? golden : endToEnd,
          exclude: shared.exclude,
          globalSetup: shared.globalSetup,
          setupFiles: shared.setupFiles,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
