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
  // @jsquash/* multithreaded wasm codecs ship workers that themselves use dynamic
  // import(); Vite must emit those workers as ES modules (the default 'iife' worker
  // format cannot code-split). Cross-origin isolation (COEP/COOP, set below + in
  // public/_headers) lets the threaded variants use SharedArrayBuffer.
  worker: {
    format: 'es',
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
    include: ['@catlabtech/webcvt-core'],
    exclude: [
      '@catlabtech/webcvt-image-canvas',
      '@catlabtech/webcvt-codec-webcodecs',
      '@catlabtech/webcvt-container-mp4',
      '@catlabtech/webcvt-container-webm',
      '@catlabtech/webcvt-subtitle',
      '@catlabtech/webcvt-archive-zip',
      '@catlabtech/webcvt-data-text',
      '@catlabtech/webcvt-backend-wasm',
      '@catlabtech/webcvt-image-jsquash-jxl',
      '@catlabtech/webcvt-image-jsquash-avif',
      '@catlabtech/webcvt-image-pdf',
    ],
  },
});
