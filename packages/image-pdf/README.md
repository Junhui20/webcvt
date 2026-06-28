# @catlabtech/webcvt-image-pdf

Wrap an image into a one-page **PDF** for [webcvt](https://github.com/Junhui20/webcvt) —
a clean-room PDF writer with **zero runtime dependencies** (no third-party PDF library).

- **JPEG → PDF** is embedded **byte-for-byte** via the PDF `DCTDecode` filter — fully
  lossless, no re-encoding, and it works in Node without a canvas.
- **PNG / WebP / BMP / GIF → PDF** are decoded to pixels and embedded as a
  Flate-compressed `DeviceRGB` image, with an `DeviceGray` **soft mask** for transparency.

## Installation

```sh
npm install @catlabtech/webcvt-image-pdf
```

No optional peer dependency — the PDF is assembled from scratch.

## Usage

```ts
import { registerPdfBackend } from '@catlabtech/webcvt-image-pdf';

// Opt-in registration.
registerPdfBackend();

// Then convert() any supported image to a PDF.
import { convert } from '@catlabtech/webcvt-core';
const pdf = await convert(jpegBlob, { format: 'pdf' });
```

Lower-level free functions:

```ts
import { jpegToPdf, imageDataToPdf } from '@catlabtech/webcvt-image-pdf';

const pdfBytes = jpegToPdf(jpegUint8Array);          // sync, lossless DCTDecode
const pdfBytes2 = await imageDataToPdf(imageData);   // RGBA → FlateDecode (+ SMask)
```

## canHandle matrix

PDF is always the **output**:

| Input | Output | Supported | Notes |
|-------|--------|-----------|-------|
| JPEG  | PDF    | yes       | Embedded losslessly via DCTDecode (no canvas) |
| PNG / WebP / BMP / GIF | PDF | yes\* | canvas bridge → Flate image (+ alpha soft mask) |

\* Non-JPEG sources need `OffscreenCanvas` (browsers/workers). JPEG works anywhere.

## Layout

Each image becomes a single page whose MediaBox equals the image dimensions in points
(1 px = 1 pt); the image fills the page. Multi-image / multi-page PDFs are out of scope
for v1.

## Security limits

| Limit | Value | Error |
|---|---|---|
| Max input bytes | 256 MiB | `PdfInputTooLargeError` |
| Max pixel count | 25 MP | `PdfDimensionsTooLargeError` |

CMYK (4-component) JPEGs are rejected with `PdfUnsupportedSourceError` in v1.

## Error types

| Class | Code |
|---|---|
| `PdfEncodeError` | `PDF_ENCODE_FAILED` |
| `PdfDecodeError` | `PDF_DECODE_FAILED` |
| `PdfUnsupportedSourceError` | `PDF_UNSUPPORTED_SOURCE` |
| `PdfInputTooLargeError` | `PDF_INPUT_TOO_LARGE` |
| `PdfDimensionsTooLargeError` | `PDF_DIMENSIONS_TOO_LARGE` |

All extend `WebcvtError` from `@catlabtech/webcvt-core`.

## Source

[packages/image-pdf/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-pdf/src)
