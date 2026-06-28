# @catlabtech/webcvt-image-pdf

Wrap an image into a one-page **PDF** — a clean-room PDF writer with zero runtime
dependencies (no third-party PDF library).

- **JPEG → PDF**: embedded byte-for-byte via `DCTDecode` (lossless, no canvas).
- **PNG / WebP / BMP / GIF → PDF**: decoded to pixels and embedded as a Flate-compressed
  `DeviceRGB` image with a `DeviceGray` soft mask for transparency.

## Installation

```bash
npm i @catlabtech/webcvt-image-pdf
```

## Supported conversions

PDF is always the output:

| Input | Output |
|-------|--------|
| JPEG | PDF (lossless DCTDecode) |
| PNG, WebP, BMP, GIF | PDF (Flate + alpha soft mask) |

Non-JPEG sources use a canvas pixel-bridge (`OffscreenCanvas`). JPEG works anywhere.

## Usage

```ts
import { registerPdfBackend } from '@catlabtech/webcvt-image-pdf';
registerPdfBackend();

import { convert } from '@catlabtech/webcvt-core';
const pdf = await convert(jpegBlob, { format: 'pdf' });
```

Free functions `jpegToPdf(bytes)` and `imageDataToPdf(imageData)` are also exported.

## Notes

- Each image becomes one page; the page size equals the image dimensions in points.
- Security caps: 256 MiB max input, 25 MP max image. CMYK JPEGs are rejected in v1.
- No wasm and no `wasm-unsafe-eval` needed — pure TypeScript plus the platform
  `CompressionStream` for the Flate path.

## Source

[packages/image-pdf/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-pdf/src)
