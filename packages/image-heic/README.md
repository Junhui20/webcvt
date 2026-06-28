# @catlabtech/webcvt-image-heic

HEIC / HEIF **decode** adapter for [webcvt](https://github.com/Junhui20/webcvt).
Turns iPhone/iPad photos (`.heic`, `.heif`) into PNG / JPEG / WebP entirely in the
browser, with no server upload. Wraps [libheif-js](https://www.npmjs.com/package/libheif-js)
(libheif compiled to WebAssembly) with lazy wasm loading, typed errors, and a clean
opt-in registration API.

> **Decode-only.** `libheif-js` ships a decoder but no encoder, so this package
> converts *from* HEIC/HEIF *to* canvas-native formats. There is no HEIC encoder.

## License notice

This package (`@catlabtech/webcvt-image-heic`) is MIT licensed.

The peer dependency `libheif-js` bundles **libheif** (LGPL-3.0) with the HEVC
decoder. `libheif-js` is an **optional** peer dependency, so pulling in the wasm
codec is explicit and intentional. Review the upstream licenses before
redistributing.

## Installation

```sh
npm install @catlabtech/webcvt-image-heic
# plus the wasm codec (optional peer):
npm install libheif-js
```

## Usage

### Opt-in registration (recommended)

```ts
import { registerHeicBackend } from '@catlabtech/webcvt-image-heic';

// Register with the default process-wide registry.
// Wasm is NOT loaded at this point — it loads lazily on the first convert().
registerHeicBackend();
```

### With a custom registry

```ts
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { registerHeicBackend } from '@catlabtech/webcvt-image-heic';

const registry = new BackendRegistry();
registerHeicBackend(registry, { maxInputBytes: 64 * 1024 * 1024 });
```

### Free functions (lower-level API)

```ts
import {
  decodeHeic,
  imageDataToBlob,
  preloadHeic,
  disposeHeic,
} from '@catlabtech/webcvt-image-heic';

await preloadHeic();                    // warm up wasm (optional)
const imageData = await decodeHeic(heicBytes);     // → ImageData (RGBA)
const jpeg = await imageDataToBlob(imageData, 'image/jpeg', 0.85);
disposeHeic();                          // free wasm memory when done
```

## canHandle matrix

The backend gates strictly to HEIC/HEIF inputs with a canvas-encodable output:

| Input | Output | Supported | Notes |
|-------|--------|-----------|-------|
| HEIC / HEIF | JPEG | yes\* | libheif decode + canvas bridge |
| HEIC / HEIF | PNG  | yes\* | libheif decode + canvas bridge |
| HEIC / HEIF | WebP | yes\* | libheif decode + canvas bridge |
| HEIC | HEIC | no | No HEIC encoder exists |
| HEIC | GIF / AVIF / JXL | no | Not canvas-encodable here |
| PNG  | HEIC | no | No HEIC encoder exists |

\* Pixel-bridge paths require `OffscreenCanvas` (or `HTMLCanvasElement` +
`document`). In Node without a canvas implementation, `canHandle()` returns
`false` for every pair (decode still works via `decodeHeic()`).

## Security limits

| Limit | Value | Error |
|---|---|---|
| Max input bytes | 256 MiB | `HeicInputTooLargeError` |
| Max pixel count | 40 MP | `HeicDimensionsTooLargeError` |

Both are overridable per-backend via `registerHeicBackend(registry, { maxInputBytes, maxPixels })`.

## CSP requirements

The `libheif-js/wasm-bundle` entry point inlines the wasm as base64 (no separate
`.wasm` fetch), so it works under a strict CSP and offline. It requires
`script-src 'wasm-unsafe-eval'` to instantiate the WebAssembly module — the same
directive the `@jsquash/*` codecs need.

## Error types

| Class | Code | When |
|---|---|---|
| `HeicLoadError` | `HEIC_LOAD_FAILED` | libheif-js not installed or wasm import failed |
| `HeicDecodeError` | `HEIC_DECODE_FAILED` | malformed / unsupported HEIC, or zero images |
| `HeicEncodeError` | `HEIC_ENCODE_FAILED` | canvas bridge failed to encode the target |
| `HeicInputTooLargeError` | `HEIC_INPUT_TOO_LARGE` | input > 256 MiB |
| `HeicDimensionsTooLargeError` | `HEIC_DIMENSIONS_TOO_LARGE` | decoded image > 40 MP |

All extend `WebcvtError` from `@catlabtech/webcvt-core`.

## Out of scope (v1)

- HEIC/HEIF **encoding** (libheif-js exposes no encoder)
- Multi-image HEIC (bursts / image sequences) — only the primary image is decoded
- Depth maps, auxiliary images, and Live Photo motion
- HDR / 10-bit round-trip beyond 8-bit RGBA
- EXIF / ICC profile preservation

## Source

[packages/image-heic/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-heic/src)
