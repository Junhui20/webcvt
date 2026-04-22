import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@catlabtech/webcvt-core': resolve(__dirname, '../core/src/index.ts'),
      '@catlabtech/webcvt-data-text': resolve(__dirname, '../data-text/src/index.ts'),
      '@catlabtech/webcvt-image-legacy': resolve(__dirname, '../image-legacy/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Bump from 5s default: register.test.ts dynamically imports 16 backend
    // packages which is slow on low-spec CI runners (Node 22 hit 5s on GHA).
    testTimeout: 15_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/cli.ts', // entry point — tested via spawn in cli-spawn.test.ts
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
