import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@catlabtech/webcvt-core': resolve(__dirname, '../core/src/index.ts'),
      '@catlabtech/webcvt-codec-webcodecs': resolve(__dirname, '../codec-webcodecs/src/index.ts'),
      '@catlabtech/webcvt-test-utils': resolve(__dirname, '../test-utils/src/index.ts'),
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
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
