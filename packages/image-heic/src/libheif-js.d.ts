// libheif-js ships no type declarations. We model only the small surface we use
// (see loader.ts for the structural types) and treat the imported module as unknown.
declare module 'libheif-js/wasm-bundle';
declare module 'libheif-js';
