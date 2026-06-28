# @catlabtech/webcvt-image-jsquash-oxipng

Lossless PNG optimisation / encoding for [webcvt](https://github.com/Junhui20/webcvt),
wrapping [@jsquash/oxipng](https://www.npmjs.com/package/@jsquash/oxipng) (OxiPNG
compiled to WebAssembly) with lazy wasm loading, typed errors, and opt-in registration.

OxiPNG losslessly re-compresses an existing PNG (often 10–40% smaller) **or** encodes
raw pixels to a freshly-optimised PNG that's smaller than the browser's canvas encoder.

> **Overlaps `@catlabtech/webcvt-image-canvas`.** Both produce `image/png`. Register
> only one per registry — use this one when you want the smallest, losslessly-optimised
> PNG output, or image-canvas for the zero-dependency / hardware-accelerated path.

## Installation

```sh
npm install @catlabtech/webcvt-image-jsquash-oxipng
# plus the wasm codec (optional peer):
npm install @jsquash/oxipng
```

## Usage

```ts
import { registerOxipngBackend } from '@catlabtech/webcvt-image-jsquash-oxipng';

// Opt-in registration — no wasm loads until the first convert().
registerOxipngBackend(undefined, { optimise: { level: 4 } });
```

Lower-level free function:

```ts
import { optimisePng } from '@catlabtech/webcvt-image-jsquash-oxipng';

// Re-compress an existing PNG losslessly…
const smaller = await optimisePng(existingPngBytes, { level: 4 });

// …or encode raw pixels (ImageData) to an optimised PNG.
const png = await optimisePng(imageData, { level: 3 });
```

## canHandle matrix

PNG is always the **output** (OxiPNG only produces PNG):

| Input | Output | Supported | Notes |
|-------|--------|-----------|-------|
| PNG   | PNG    | yes       | Lossless re-compression (no decode, no bridge) |
| JPEG / WebP | PNG | yes\* | canvas bridge decode → OxiPNG encode |

\* Cross-format paths need `OffscreenCanvas` (browsers/workers). PNG→PNG works anywhere.

## Options

```ts
interface OxipngOptions {
  level?: number;          // 0 (fast) – 6 (smallest), default 2
  interlace?: boolean;     // Adam7 interlacing, default false
  optimiseAlpha?: boolean; // lossy alpha for fully-transparent pixels, default false
}
```

OxiPNG is lossless, so there is no `quality` knob — `level` trades encode time for size.

## Security limits

| Limit | Value | Error |
|---|---|---|
| Max input bytes | 256 MiB | `OxipngInputTooLargeError` |
| Max pixel count (ImageData) | 25 MP | `OxipngDimensionsTooLargeError` |

## CSP requirements

The `@jsquash/oxipng` wasm binary requires `script-src 'wasm-unsafe-eval'`. The
multi-threaded variant additionally needs cross-origin isolation (COOP/COEP).

## Error types

| Class | Code |
|---|---|
| `OxipngLoadError` | `OXIPNG_LOAD_FAILED` |
| `OxipngOptimiseError` | `OXIPNG_OPTIMISE_FAILED` |
| `OxipngDecodeError` | `OXIPNG_DECODE_FAILED` |
| `OxipngInputTooLargeError` | `OXIPNG_INPUT_TOO_LARGE` |
| `OxipngDimensionsTooLargeError` | `OXIPNG_DIMENSIONS_TOO_LARGE` |

All extend `WebcvtError` from `@catlabtech/webcvt-core`.

## Source

[packages/image-jsquash-oxipng/src](https://github.com/Junhui20/webcvt/tree/main/packages/image-jsquash-oxipng/src)
