# @catlabtech/webcvt-image-jsquash-avif

AVIF decode/encode backend for webcvt, wrapping
[@jsquash/avif](https://www.npmjs.com/package/@jsquash/avif) (libavif in WebAssembly).

AVIF (AV1 Image File Format, ISO/IEC 23000-22) encodes still images with the AV1
codec for excellent compression at low bitrates.

## Installation

```bash
npm i @catlabtech/webcvt-image-jsquash-avif @jsquash/avif
```

`@jsquash/avif` is an optional peer dependency licensed Apache-2.0 (with an AV1
patent grant) — installing it is explicit.

## Supported conversions

| Input | Output |
|-------|--------|
| AVIF | AVIF, PNG, JPEG, WebP |
| PNG, JPEG, WebP | AVIF |

Cross-format paths use a canvas pixel-bridge and need `OffscreenCanvas`. AVIF→AVIF
re-encoding works anywhere.

## Usage

```ts
import { registerAvifBackend } from '@catlabtech/webcvt-image-jsquash-avif';

// Opt-in registration — no wasm is loaded until the first conversion.
registerAvifBackend();
```

Then call `convert()` from `@catlabtech/webcvt-core` as usual. Lower-level
`decodeAvif` / `encodeAvif` free functions are also exported.

## Encode options

```ts
{
  quality?: number;       // 0–100, default 50
  speed?: number;         // 0–10 (0 = slowest/best), default 6
  subsample?: 0|1|2|3;    // chroma subsampling, default 1 (4:2:2)
  qualityAlpha?: number;  // -1–100, default -1 (use main quality)
}
```

## Notes

- The wasm codec needs `script-src 'wasm-unsafe-eval'`; the multi-threaded variant
  additionally needs cross-origin isolation (COOP/COEP).
- Security caps: 256 MiB max input, 25 MP max image (typed errors on violation).

## Source

[packages/image-jsquash-avif/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-avif/src)
