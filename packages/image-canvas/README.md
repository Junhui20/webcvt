# @webcvt/image-canvas

Browser-native image conversion backend for [webcvt](https://github.com/webcvt/webcvt).

Converts between PNG, JPG, WebP, BMP, and ICO using nothing but the browser's Canvas API (`createImageBitmap` + `OffscreenCanvas` + `convertToBlob`). No WASM. No external codecs.

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

## Implementation references

- ICO file format: https://en.wikipedia.org/wiki/ICO_(file_format)
- BMP file format: https://en.wikipedia.org/wiki/BMP_file_format (BITMAPINFOHEADER, BI_RGB)
- OffscreenCanvas API: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- createImageBitmap: https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap

## License

MIT
