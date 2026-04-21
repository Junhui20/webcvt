import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  define: {
    'import.meta.env.VITE_WEBCVT_VERSION': JSON.stringify(rootPkg.version),
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    include: ['@webcvt/core'],
    exclude: [
      '@webcvt/image-canvas',
      '@webcvt/codec-webcodecs',
      '@webcvt/container-mp4',
      '@webcvt/container-webm',
      '@webcvt/subtitle',
      '@webcvt/archive-zip',
      '@webcvt/data-text',
      '@webcvt/backend-wasm',
    ],
  },
});
