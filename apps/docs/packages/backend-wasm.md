# @webcvt/backend-wasm

> ffmpeg.wasm fallback backend for webcvt. Handles any format pair not covered by the native backends.

## Installation

```bash
npm i @webcvt/backend-wasm
```

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/backend-wasm/src) for now.

## Notes

This backend ships a ~4 MB WebAssembly blob (a build of FFmpeg). Load it lazily when possible:

```ts
async function ensureWasm() {
  const { WasmBackend } = await import('@webcvt/backend-wasm');
  defaultRegistry.register(new WasmBackend());
}
```

Requires COEP/COOP headers for multithreading. See [Browser Usage](/guide/browser-usage#coep--coop-headers).
