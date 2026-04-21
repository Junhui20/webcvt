# @webcvt/image-canvas

Browser-native image conversion backend for webcvt.

Converts between PNG, JPG, WebP, BMP, and ICO using nothing but the browser's Canvas API (`createImageBitmap` + `OffscreenCanvas` + `convertToBlob`). No WASM. No external codecs.

## Installation

```bash
npm i @webcvt/image-canvas
```

## Supported conversions

| Input | Output |
|-------|--------|
| PNG, JPG/JPEG, WebP, BMP, ICO, GIF (decode only) | PNG, JPG/JPEG, WebP, BMP, ICO |

GIF can be decoded as input but cannot be produced as output (the Canvas API does not encode GIF).

## Usage

```ts
import { CanvasBackend } from '@webcvt/image-canvas';
import { defaultRegistry } from '@webcvt/core';

// Register once
defaultRegistry.register(new CanvasBackend());
```

Then use `convert()` from `@webcvt/core` as normal. The canvas backend is selected automatically for supported format pairs.

## Why Canvas?

The Canvas API is zero-cost — it uses the browser's built-in image codecs which are typically hardware-accelerated. This makes `@webcvt/image-canvas` the fastest and smallest backend for common web image formats.

For formats not supported by Canvas (GIF encoding, TIFF, PBM, QOI, etc.) use `@webcvt/image-legacy` or `@webcvt/backend-wasm`.

## Source

[packages/image-canvas/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-canvas/src)
