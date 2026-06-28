# @catlabtech/webcvt-image-heic

HEIC / HEIF **decode** backend for webcvt, wrapping
[libheif-js](https://www.npmjs.com/package/libheif-js) (libheif in WebAssembly).

Convert iPhone/iPad photos (`.heic`, `.heif`) to PNG / JPEG / WebP entirely in the
browser — no upload, no server. Decode-only: `libheif-js` ships a decoder but no
encoder, so there is no HEIC *output*.

## Installation

```bash
npm i @catlabtech/webcvt-image-heic libheif-js
```

`libheif-js` is an optional peer dependency — installing it is explicit.

## Supported conversions

| Input | Output |
|-------|--------|
| HEIC, HEIF | JPEG, PNG, WebP |

All paths decode with libheif (wasm) and re-encode through a canvas pixel-bridge,
so they need `OffscreenCanvas` (browsers, workers). In Node without a canvas, use
the lower-level `decodeHeic()` to get raw `ImageData`.

## Usage

```ts
import { registerHeicBackend } from '@catlabtech/webcvt-image-heic';

// Opt-in registration — no wasm is loaded until the first conversion.
registerHeicBackend();
```

Then call `convert()` from `@catlabtech/webcvt-core` as usual; the HEIC backend is
selected automatically for the pairs above. Lower-level `decodeHeic` /
`imageDataToBlob` free functions are also exported.

```ts
import { decodeHeic, imageDataToBlob } from '@catlabtech/webcvt-image-heic';

const imageData = await decodeHeic(heicBytes);          // → ImageData (RGBA)
const jpeg = await imageDataToBlob(imageData, 'image/jpeg', 0.85);
```

## Notes

- The `libheif-js/wasm-bundle` entry inlines the wasm as base64 (no separate
  `.wasm` fetch), so it works under a strict CSP and offline. It needs
  `script-src 'wasm-unsafe-eval'`.
- Only the **primary** image of a HEIC is decoded — bursts / image sequences,
  depth maps, and auxiliary images are out of scope for v1.
- Security caps: 256 MiB max input, 40 MP max image (typed errors on violation).

## Source

[packages/image-heic/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-heic/src)
