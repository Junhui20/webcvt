# @catlabtech/webcvt-image-jsquash-jxl

JPEG XL (JXL) decode/encode backend for webcvt, wrapping
[@jsquash/jxl](https://www.npmjs.com/package/@jsquash/jxl) (libjxl in WebAssembly).

JPEG XL is a modern, **royalty-free** image codec (ISO/IEC 18181) with both lossy
and mathematically-lossless modes, progressive decoding, and wide-gamut support.

## Installation

```bash
npm i @catlabtech/webcvt-image-jsquash-jxl @jsquash/jxl
```

`@jsquash/jxl` is an optional peer dependency — installing it is explicit.

## Supported conversions

| Input | Output |
|-------|--------|
| JXL | JXL, PNG, JPEG, WebP |
| PNG, JPEG, WebP | JXL |

Cross-format paths (e.g. PNG→JXL) use a canvas pixel-bridge and therefore need
`OffscreenCanvas` (browsers, workers). JXL→JXL re-encoding works anywhere.

## Usage

```ts
import { registerJxlBackend } from '@catlabtech/webcvt-image-jsquash-jxl';

// Opt-in registration — no wasm is loaded until the first conversion.
registerJxlBackend();
```

Then call `convert()` from `@catlabtech/webcvt-core` as usual; the JXL backend is
selected automatically for the pairs above. Lower-level `decodeJxl` / `encodeJxl`
free functions are also exported.

## Encode options

```ts
{
  quality?: number;       // 0–100 (higher = better), default 75
  effort?: number;        // 1–9 (higher = slower/smaller), default 7
  lossless?: boolean;     // default false
  progressive?: boolean;  // default false
}
```

## Notes

- The wasm codec needs `script-src 'wasm-unsafe-eval'`; the multi-threaded variant
  additionally needs cross-origin isolation (COOP/COEP) and falls back to the
  single-threaded codec otherwise.
- Security caps: 256 MiB max input, 25 MP max image (typed errors on violation).

## Source

[packages/image-jsquash-jxl/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-jxl/src)
