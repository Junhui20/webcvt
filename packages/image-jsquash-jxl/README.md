# @catlabtech/webcvt-image-jsquash-jxl

JPEG XL (JXL) decode/encode adapter for [webcvt](https://github.com/Junhui20/webcvt).
Wraps [@jsquash/jxl](https://www.npmjs.com/package/@jsquash/jxl) (libjxl, compiled to
WebAssembly) with lazy wasm loading, typed errors, and a clean opt-in registration API.

JPEG XL is a modern, **royalty-free** raster codec supporting both lossy and
mathematically-lossless compression, wide gamut, and progressive decoding.

## License notice

This package (`@catlabtech/webcvt-image-jsquash-jxl`) is MIT licensed.

The peer dependency `@jsquash/jxl` bundles **libjxl** (BSD-3-Clause). JPEG XL is a
royalty-free standard (ISO/IEC 18181). `@jsquash/jxl` is an **optional** peer
dependency, so installing the wasm codec is explicit and intentional.

## Installation

```sh
npm install @catlabtech/webcvt-image-jsquash-jxl
# plus the wasm codec (optional peer):
npm install @jsquash/jxl
```

## Usage

### Opt-in registration (recommended)

```ts
import { registerJxlBackend } from '@catlabtech/webcvt-image-jsquash-jxl';

// Register with the default process-wide registry.
// Wasm is NOT loaded at this point — it loads lazily on the first convert().
registerJxlBackend();
```

### With a custom registry

```ts
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { registerJxlBackend } from '@catlabtech/webcvt-image-jsquash-jxl';

const registry = new BackendRegistry();
registerJxlBackend(registry, { encode: { quality: 80, effort: 5 } });
```

### Free functions (lower-level API)

```ts
import {
  decodeJxl,
  encodeJxl,
  preloadJxl,
  disposeJxl,
} from '@catlabtech/webcvt-image-jsquash-jxl';

await preloadJxl();                 // warm up wasm (optional)
const imageData = await decodeJxl(jxlBytes);
const encoded = await encodeJxl(imageData, {
  quality: 80,      // 0–100 (higher = better), default 75. 100 ≈ visually lossless
  effort: 5,        // 1–9 (higher = slower/smaller), default 7
  lossless: false,  // true = mathematically lossless (ignores quality)
  progressive: false,
});
disposeJxl();                       // free wasm memory when done
```

## canHandle matrix

The backend gates strictly to conversions where JXL is on at least one side:

| Input | Output | Supported | Notes |
|-------|--------|-----------|-------|
| JXL   | JXL    | yes       | Re-encode / quality adjustment |
| JXL   | PNG / JPEG / WebP | yes\* | jsquash decode + canvas bridge |
| PNG / JPEG / WebP | JXL | yes\* | canvas bridge + jsquash encode |
| PNG   | JPEG   | no        | Use `@catlabtech/webcvt-image-canvas` |

\* Pixel-bridge paths require `OffscreenCanvas` (or `HTMLCanvasElement` + `document`).
In Node without a canvas implementation, only JXL→JXL is available.

## Encode options

```ts
interface JxlEncodeOptions {
  quality?: number;       // 0–100 (higher = better), default 75
  effort?: number;        // 1–9 (higher = slower/smaller), default 7
  lossless?: boolean;     // default false; when true, quality is ignored
  progressive?: boolean;  // default false
}
```

Unlike AVIF (which uses an inverted `cqLevel`), JPEG XL's quality scale is direct.

## Security limits

| Limit | Value | Error |
|---|---|---|
| Max input bytes | 256 MiB | `JxlInputTooLargeError` |
| Max pixel count | 25 MP | `JxlDimensionsTooLargeError` |

## CSP requirements

The `@jsquash/jxl` wasm binary requires `script-src 'wasm-unsafe-eval'`. The
multi-threaded codec variant additionally needs the page to be **cross-origin
isolated** (`Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp`); it transparently falls back to the
single-threaded codec otherwise.

## Error types

| Class | Code | When |
|---|---|---|
| `JxlLoadError` | `JXL_LOAD_FAILED` | @jsquash/jxl not installed or wasm fetch failed |
| `JxlDecodeError` | `JXL_DECODE_FAILED` | malformed or unsupported JXL data |
| `JxlEncodeError` | `JXL_ENCODE_FAILED` | invalid options or wasm OOM |
| `JxlInputTooLargeError` | `JXL_INPUT_TOO_LARGE` | input > 256 MiB |
| `JxlDimensionsTooLargeError` | `JXL_DIMENSIONS_TOO_LARGE` | image > 25 MP |

All extend `WebcvtError` from `@catlabtech/webcvt-core`.

## Out of scope (v1)

- Animated JPEG XL
- HDR / wide-gamut round-trip beyond 8-bit RGBA
- ICC profile preservation
- Lossless JPEG→JXL transcoding (bit-exact recompression)
- Streaming decode / worker-thread offload from this wrapper (the codec itself may
  still use its own worker for the multi-threaded path)

## Source

[packages/image-jsquash-jxl/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-jxl/src)
