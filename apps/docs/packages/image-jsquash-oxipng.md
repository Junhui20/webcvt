# @catlabtech/webcvt-image-jsquash-oxipng

Lossless PNG optimisation / encoding backend for webcvt, wrapping
[@jsquash/oxipng](https://www.npmjs.com/package/@jsquash/oxipng) (OxiPNG in WebAssembly).

OxiPNG losslessly re-compresses an existing PNG (often 10–40% smaller) or encodes raw
pixels to a smaller PNG than the browser's canvas encoder.

::: tip Overlaps image-canvas
Both this backend and `@catlabtech/webcvt-image-canvas` produce `image/png`. Register
only one per registry: this one for the smallest lossless output, image-canvas for the
zero-dependency / hardware-accelerated path.
:::

## Installation

```bash
npm i @catlabtech/webcvt-image-jsquash-oxipng @jsquash/oxipng
```

## Supported conversions

PNG is always the output:

| Input | Output |
|-------|--------|
| PNG | PNG (lossless re-compression) |
| JPEG, WebP | PNG |

Cross-format paths use a canvas pixel-bridge (`OffscreenCanvas`). PNG→PNG works anywhere.

## Usage

```ts
import { registerOxipngBackend } from '@catlabtech/webcvt-image-jsquash-oxipng';

registerOxipngBackend(undefined, { optimise: { level: 4 } });
```

Free function `optimisePng(bytesOrImageData, options)` is also exported.

## Options

```ts
{
  level?: number;          // 0 (fast) – 6 (smallest), default 2
  interlace?: boolean;     // default false
  optimiseAlpha?: boolean; // default false
}
```

OxiPNG is lossless — there is no `quality` knob; `level` trades encode time for size.

## Notes

- The wasm codec needs `script-src 'wasm-unsafe-eval'`.
- Security caps: 256 MiB max input, 25 MP max image (typed errors on violation).

## Source

[packages/image-jsquash-oxipng/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-oxipng/src)
