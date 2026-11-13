import { defineConfig } from 'vitest/config';

/** Minimum coverage (global): 80% for lines, statements, functions and branches. AGENTS.md quotes these, so update it too. */
const COVERAGE_THRESHOLDS = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 80,
} as const;

export default defineConfig({
  // issueLinks.test.ts reads the issue forms in ../.github to check the prefill field ids.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
    pool: 'threads',
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: { ...COVERAGE_THRESHOLDS },
    },
  },
});
