import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@webcvt/core': resolve(__dirname, '../core/src/index.ts'),
      '@webcvt/data-text': resolve(__dirname, '../data-text/src/index.ts'),
      '@webcvt/image-legacy': resolve(__dirname, '../image-legacy/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
