import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Tests of the web panel under web/ declare `@vitest-environment jsdom` themselves.
    include: ['test/**/*.test.ts', 'web/**/*.test.tsx'],
    exclude: [...configDefaults.exclude, 'integrations/**'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts', 'web/test/setup.ts'],
    testTimeout: 30_000,
  },
});
