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
          include: endToEnd,
          exclude: shared.exclude,
          globalSetup: shared.globalSetup,
          setupFiles: shared.setupFiles,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
