import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@catlabtech/webcvt-core': resolve(__dirname, '../core/src/index.ts'),
      '@catlabtech/webcvt-codec-webcodecs': resolve(__dirname, '../codec-webcodecs/src/index.ts'),
      '@catlabtech/webcvt-container-wav': resolve(__dirname, '../container-wav/src/index.ts'),
      '@catlabtech/webcvt-container-ogg': resolve(__dirname, '../container-ogg/src/index.ts'),
      '@catlabtech/webcvt-container-webm': resolve(__dirname, '../container-webm/src/index.ts'),
      '@catlabtech/webcvt-container-mp3': resolve(__dirname, '../container-mp3/src/index.ts'),
      '@catlabtech/webcvt-container-flac': resolve(__dirname, '../container-flac/src/index.ts'),
      '@catlabtech/webcvt-container-aac': resolve(__dirname, '../container-aac/src/index.ts'),
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
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/_test-helpers/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
