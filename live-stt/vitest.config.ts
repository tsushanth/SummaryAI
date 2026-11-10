import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The replay integration test measures heap growth, so run files one at a time.
    fileParallelism: false,
  },
});
