# @catlabtech/webcvt-image-jsquash-avif

AVIF decode/encode adapter for [webcvt](https://github.com/catlabtech/webcvt).
Wraps [@jsquash/avif](https://www.npmjs.com/package/@jsquash/avif) with lazy wasm loading,
typed errors, and a clean opt-in registration API.

## License notice

This package (`@catlabtech/webcvt-image-jsquash-avif`) is MIT licensed.

The peer dependency `@jsquash/avif` is licensed under **Apache-2.0** and includes an
**explicit AV1 patent grant**. You must install `@jsquash/avif` separately; it is listed
as an optional peer dependency so the install is explicit and intentional.

If you ship software in contexts with active AV1 patent disputes, consult your legal team
before deploying. The Apache-2.0 + AV1 patent grant is generally considered commercially
safe for most use cases.

## Installation

```sh
# Install this adapter
npm install @catlabtech/webcvt-image-jsquash-avif

# Install the required peer dependency (Apache-2.0)
npm install @jsquash/avif
```

## Usage

### Opt-in registration (recommended)

```ts
import { registerAvifBackend } from '@catlabtech/webcvt-image-jsquash-avif';

// Register with the default process-wide registry.
// Wasm is NOT loaded at this point.
registerAvifBackend();

// The registry will use AvifBackend for AVIF conversions.
// Wasm loads lazily on the first convert() call.
```

### With a custom registry

```ts
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { registerAvifBackend } from '@catlabtech/webcvt-image-jsquash-avif';

const registry = new BackendRegistry();
registerAvifBackend(registry, {
  encode: { quality: 70, speed: 6 },
});
```

### Free functions (lower-level API)

```ts
import {
  decodeAvif,
  encodeAvif,
  preloadAvif,
  disposeAvif,
} from '@catlabtech/webcvt-image-jsquash-avif';

// Warm up wasm (optional)
await preloadAvif();

// Decode AVIF bytes to ImageData
const imageData = await decodeAvif(avifBytes);

// Encode ImageData to AVIF
const encoded = await encodeAvif(imageData, {
  quality: 60,    // 0–100, default 50
  speed: 6,       // 0–10 (0=slowest/best quality), default 6
  subsample: 1,   // 0=4:4:4, 1=4:2:2 (default), 2=4:2:0, 3=monochrome
});

// Free wasm memory when done
disposeAvif();
```

## canHandle matrix

The backend gates strictly to conversions where AVIF is on at least one side:

| Input   | Output  | Supported | Notes |
|---------|---------|-----------|-------|
| AVIF    | AVIF    | yes       | Re-encode, quality adjustment |
| AVIF    | PNG     | yes*      | jsquash decode + canvas bridge |
| AVIF    | JPEG    | yes*      | jsquash decode + canvas bridge |
| AVIF    | WebP    | yes*      | jsquash decode + canvas bridge |
| PNG     | AVIF    | yes*      | canvas bridge + jsquash encode |
| JPEG    | AVIF    | yes*      | canvas bridge + jsquash encode |
| WebP    | AVIF    | yes*      | canvas bridge + jsquash encode |
| PNG     | JPEG    | no        | Use `@catlabtech/webcvt-image-canvas` |

\* Pixel bridge paths require `OffscreenCanvas` or `HTMLCanvasElement + document`.
In Node.js environments without a canvas implementation, only AVIF→AVIF is available.

## Encode options (v1)

```ts
interface AvifEncodeOptions {
  quality?: number;        // 0–100, default 50
  speed?: number;          // 0–10, default 6
  subsample?: 0|1|2|3;    // chroma subsampling, default 1 (4:2:2)
  qualityAlpha?: number;   // -1–100, default -1 (use main quality)
  bitDepth?: 8|10|12;      // only 8 supported in v1 (see below)
}
```

Note: `bitDepth` 10 and 12 throw `AvifEncodeError` in v1. Browser canvas
`getImageData` always returns 8-bit data; encoding it as 10/12-bit would produce
incorrect output. True HDR round-trip requires the VideoFrame API (planned for v0.3+).

## Deferred encode options (v0.3+)

The following jsquash options are available in `@jsquash/avif` but deferred from
the v1 surface to keep the API minimal:
- `denoiseLevel`
- `tileColsLog2` / `tileRowsLog2`
- `chromaDeltaQ`
- `sharpness`
- `tune`
- `enableSharpYUV`

Open an issue or PR if you need these sooner.

## AbortSignal

`AbortSignal` is honoured between every async phase. Note that mid-encode abort
is not possible — `@jsquash/avif` provides no abort hook. Once `encode()` is
called internally, aborting only takes effect after it returns.

```ts
const ac = new AbortController();
const result = backend.convert(blob, AVIF_FORMAT, {
  format: 'avif',
  signal: ac.signal,
});

// Abort before encode starts (effective)
ac.abort();
```

## Security limits

| Limit | Value | Error |
|---|---|---|
| Max input bytes | 256 MiB | `AvifInputTooLargeError` |
| Max pixel count | 100 MP | `AvifDimensionsTooLargeError` |

## CSP requirements

The `@jsquash/avif` wasm binary requires:

```
Content-Security-Policy: script-src 'wasm-unsafe-eval'
```

To host the wasm file yourself and avoid `wasm-unsafe-eval`, pass a
pre-compiled `WebAssembly.Module` via `AvifLoadOptions.module`:

```ts
const wasmModule = await WebAssembly.compileStreaming(fetch('/assets/avif.wasm'));
registerAvifBackend(undefined, {
  load: { module: wasmModule },
});
```

## Error types

| Class | Code | When |
|---|---|---|
| `AvifLoadError` | `AVIF_LOAD_FAILED` | @jsquash/avif not installed or wasm fetch failed |
| `AvifDecodeError` | `AVIF_DECODE_FAILED` | malformed or unsupported AVIF data |
| `AvifEncodeError` | `AVIF_ENCODE_FAILED` | invalid options or wasm OOM |
| `AvifInputTooLargeError` | `AVIF_INPUT_TOO_LARGE` | input > 256 MiB |
| `AvifDimensionsTooLargeError` | `AVIF_DIMENSIONS_TOO_LARGE` | image > 100 MP |

All extend `WebcvtError` from `@catlabtech/webcvt-core`.

## Out of scope (v1)

- Animated AVIF / AVIS image sequences
- HDR / PQ / HLG transfer characteristics
- Custom ICC profile preservation
- Multi-image grids (HEIF-style tiled AVIF)
- 10/12-bit-depth round-trip
- Streaming decode
- Worker-thread offload
