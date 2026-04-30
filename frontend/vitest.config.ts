import { defineConfig } from 'vitest/config';

/** Minimum coverage (global). Lines/statements/functions at 80%; branches lower to allow “yellow” while staying above a strict red zone. */
const COVERAGE_THRESHOLDS = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 80,
} as const;

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    pool: 'threads',
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: { ...COVERAGE_THRESHOLDS },
    },
  },
});
