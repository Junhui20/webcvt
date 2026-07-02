import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Alias every workspace package this suite imports to its TypeScript source
// (src/index.ts) rather than its built dist/. This mirrors the data-text
// package's own vitest config and lets the integration tests exercise the
// *current* source of core AND the real backends without a build step. The
// core alias is applied globally, so it also resolves each backend's own
// `import ... from '@catlabtech/webcvt-core'` transitively.
const pkg = (name: string): string => resolve(__dirname, `../${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@catlabtech/webcvt-core': pkg('core'),
      '@catlabtech/webcvt-container-wav': pkg('container-wav'),
      '@catlabtech/webcvt-subtitle': pkg('subtitle'),
      '@catlabtech/webcvt-data-text': pkg('data-text'),
      '@catlabtech/webcvt-archive-zip': pkg('archive-zip'),
      '@catlabtech/webcvt-email': pkg('email'),
      '@catlabtech/webcvt-font': pkg('font'),
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
      // This package contains no product source — it only imports other
      // packages — so its own coverage is intentionally not gated.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/_helpers.ts'],
    },
  },
});
