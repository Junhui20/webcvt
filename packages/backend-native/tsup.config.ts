import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    resolve: true,
    compilerOptions: {
      allowImportingTsExtensions: true,
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      noEmit: false,
    },
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  treeshake: true,
});
