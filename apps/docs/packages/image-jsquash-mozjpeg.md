# @catlabtech/webcvt-image-jsquash-mozjpeg

High-quality JPEG decode/encode backend for webcvt, wrapping
[@jsquash/jpeg](https://www.npmjs.com/package/@jsquash/jpeg) (MozJPEG in WebAssembly).

MozJPEG produces smaller JPEGs than the browser's built-in encoder (trellis
quantisation, progressive coding) — choose this backend when output size matters.

::: tip Overlaps image-canvas
Both this backend and `@catlabtech/webcvt-image-canvas` handle `image/jpeg`. Register
only one per registry: this one for best compression, image-canvas for the
zero-dependency / hardware-accelerated path.
:::

## Installation

```bash
npm i @catlabtech/webcvt-image-jsquash-mozjpeg @jsquash/jpeg
```

## Supported conversions

| Input | Output |
|-------|--------|
| JPEG | JPEG (recompress), PNG, WebP |
| PNG, WebP | JPEG |

Cross-format paths use a canvas pixel-bridge (`OffscreenCanvas`). JPEG→JPEG works anywhere.

## Usage

```ts
import { registerMozjpegBackend } from '@catlabtech/webcvt-image-jsquash-mozjpeg';

registerMozjpegBackend(undefined, { encode: { quality: 80, progressive: true } });
```

Free functions `decodeMozjpeg` / `encodeMozjpeg` are also exported.

## Encode options

```ts
{
  quality?: number;       // 0–100, default 75
  progressive?: boolean;  // default false
  baseline?: boolean;     // default false
}
```

## Notes

- The wasm codec needs `script-src 'wasm-unsafe-eval'`.
- Security caps: 256 MiB max input, 25 MP max image (typed errors on violation).

## Source

[packages/image-jsquash-mozjpeg/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-mozjpeg/src)
