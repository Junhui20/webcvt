# @catlabtech/webcvt-image-jsquash-mozjpeg

High-quality JPEG decode/encode adapter for [webcvt](https://github.com/Junhui20/webcvt),
wrapping [@jsquash/jpeg](https://www.npmjs.com/package/@jsquash/jpeg) (MozJPEG compiled
to WebAssembly) with lazy wasm loading, typed errors, and opt-in registration.

MozJPEG produces noticeably smaller JPEGs than the browser's built-in encoder
(trellis quantisation, progressive coding), making this the backend to choose when
output size matters.

> **Overlaps `@catlabtech/webcvt-image-canvas`.** Both handle `image/jpeg`. Register
> only one per registry — use this one when you want MozJPEG's better compression,
> or image-canvas when you want the zero-dependency, hardware-accelerated path.

## Installation

```sh
npm install @catlabtech/webcvt-image-jsquash-mozjpeg
# plus the wasm codec (optional peer):
npm install @jsquash/jpeg
```

## Usage

```ts
import { registerMozjpegBackend } from '@catlabtech/webcvt-image-jsquash-mozjpeg';

// Opt-in registration — no wasm loads until the first convert().
registerMozjpegBackend(undefined, { encode: { quality: 80, progressive: true } });
```

Lower-level free functions are also exported:

```ts
import { decodeMozjpeg, encodeMozjpeg } from '@catlabtech/webcvt-image-jsquash-mozjpeg';

const imageData = await decodeMozjpeg(jpegBytes);
const smaller = await encodeMozjpeg(imageData, { quality: 80, progressive: true });
```

## canHandle matrix

| Input | Output | Supported | Notes |
|-------|--------|-----------|-------|
| JPEG  | JPEG   | yes       | Recompress (often smaller than the source) |
| JPEG  | PNG / WebP | yes\* | MozJPEG decode + canvas bridge |
| PNG / WebP | JPEG | yes\* | canvas bridge + MozJPEG encode |

\* Cross-format paths need `OffscreenCanvas` (browsers/workers). JPEG→JPEG works anywhere.

## Encode options

```ts
interface MozjpegEncodeOptions {
  quality?: number;       // 0–100 (higher = better), default 75
  progressive?: boolean;  // default false
  baseline?: boolean;     // default false (force non-optimised baseline)
}
```

## Security limits

| Limit | Value | Error |
|---|---|---|
| Max input bytes | 256 MiB | `MozjpegInputTooLargeError` |
| Max pixel count | 25 MP | `MozjpegDimensionsTooLargeError` |

## CSP requirements

The `@jsquash/jpeg` wasm binary requires `script-src 'wasm-unsafe-eval'`.

## Error types

| Class | Code |
|---|---|
| `MozjpegLoadError` | `MOZJPEG_LOAD_FAILED` |
| `MozjpegDecodeError` | `MOZJPEG_DECODE_FAILED` |
| `MozjpegEncodeError` | `MOZJPEG_ENCODE_FAILED` |
| `MozjpegInputTooLargeError` | `MOZJPEG_INPUT_TOO_LARGE` |
| `MozjpegDimensionsTooLargeError` | `MOZJPEG_DIMENSIONS_TOO_LARGE` |

All extend `WebcvtError` from `@catlabtech/webcvt-core`.

## Source

[packages/image-jsquash-mozjpeg/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-mozjpeg/src)
