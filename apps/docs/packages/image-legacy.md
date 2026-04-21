# @webcvt/image-legacy

> Pure TypeScript decoders and encoders for legacy and scientific image formats not supported by the browser Canvas API.

## Installation

```bash
npm i @webcvt/image-legacy
```

## Supported formats

PBM, PGM, PPM (Netpbm), PFM, QOI, XBM, PCX, XPM, TIFF, ICNS, TGA, and more.

## API

Detailed API reference coming in v0.2. See the [source code](https://github.com/Junhui20/webcvt/tree/main/packages/image-legacy/src) for now.

## Notes

All codecs are implemented in pure TypeScript with no WASM. Register this backend alongside `@webcvt/image-canvas` to expand the range of supported input formats:

```ts
import { CanvasBackend } from '@webcvt/image-canvas';
import { LegacyImageBackend } from '@webcvt/image-legacy';
import { defaultRegistry } from '@webcvt/core';

defaultRegistry.register(new CanvasBackend());
defaultRegistry.register(new LegacyImageBackend());
```
